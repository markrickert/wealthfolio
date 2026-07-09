use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::secret_store::KeyringSecretStore;
use tauri::{AppHandle, Manager, State};
use wealthfolio_core::addons::network::{
    resolve_addon_network_auth_header, AddonNetworkRequest, AddonNetworkResponse,
};
use wealthfolio_core::addons::{
    parse_manifest_json_metadata, AddonManifest, AddonService, AddonServiceTrait,
};

use crate::context::ServiceContext;

/// In-memory manifests for addons currently running via `pnpm dev:server`.
///
/// Dev-server addons are hot-loaded straight into the sandbox by the frontend and are
/// never written to the installed addons directory, so the normal disk-backed lookup
/// in `AddonService` can't find them. This registry lets the network broker (the only
/// addon API that must be resolved host-side) recognize them anyway. Entries are
/// ephemeral — populated by `register_dev_addon_manifest` when the frontend loads or
/// reloads a dev addon, and cleared on `unregister_dev_addon_manifest` or app restart.
#[derive(Default)]
pub struct DevAddonRegistry(Mutex<HashMap<String, AddonManifest>>);

impl DevAddonRegistry {
    fn get(&self, addon_id: &str) -> Option<AddonManifest> {
        self.0.lock().unwrap().get(addon_id).cloned()
    }
}

#[tauri::command]
pub fn register_dev_addon_manifest(
    registry: State<'_, DevAddonRegistry>,
    addon_id: String,
    manifest_json: String,
) -> Result<(), String> {
    let mut manifest = parse_manifest_json_metadata(&manifest_json)?;
    if manifest.id != addon_id {
        return Err(format!(
            "Dev addon manifest id '{}' does not match requested addon id '{}'",
            manifest.id, addon_id
        ));
    }
    // Dev mode has no install-time permission-approval dialog, so there's no
    // separate user-approved host list to read. Treat the addon's own declared
    // hosts as approved — the same trust already implicitly extended to every
    // other API (secrets, accounts, activities, ...) when running via a local
    // dev server the user explicitly started.
    if let Some(network) = manifest.network.as_mut() {
        network.approved_hosts = network.allowed_hosts.clone();
    }
    registry.0.lock().unwrap().insert(addon_id, manifest);
    Ok(())
}

#[tauri::command]
pub fn unregister_dev_addon_manifest(registry: State<'_, DevAddonRegistry>, addon_id: String) {
    registry.0.lock().unwrap().remove(&addon_id);
}

#[tauri::command]
pub async fn addon_network_request(
    app_handle: AppHandle,
    state: State<'_, Arc<ServiceContext>>,
    dev_registry: State<'_, DevAddonRegistry>,
    addon_id: String,
    mut request: AddonNetworkRequest,
) -> Result<AddonNetworkResponse, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let injected_authorization =
        resolve_addon_network_auth_header(&addon_id, request.auth.as_ref(), &KeyringSecretStore)?;
    request.injected_authorization = injected_authorization;
    let service = AddonService::new(
        app_data_dir,
        state.rating_instance_id.as_str(),
        state.addon_storage_repository.clone(),
    );

    // A running dev server takes precedence over an installed copy, mirroring the
    // frontend's own dev-mode override — otherwise the sidebar/route would run the
    // live dev code while network requests silently used a stale installed manifest.
    if let Some(manifest) = dev_registry.get(&addon_id) {
        return service
            .addon_network_request_with_manifest(&addon_id, manifest, request)
            .await;
    }

    service.addon_network_request(&addon_id, request).await
}
