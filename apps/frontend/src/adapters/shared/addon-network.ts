import type { AddonNetworkRequest, AddonNetworkResponse } from "../types";
import { invoke } from "./platform";

export const addonNetworkRequest = async (
  addonId: string,
  request: AddonNetworkRequest,
): Promise<AddonNetworkResponse> => {
  return invoke<AddonNetworkResponse>("addon_network_request", {
    addonId,
    request,
  });
};

/**
 * Registers a dev-server addon's manifest with the backend so `addonNetworkRequest` can
 * resolve permissions/approved hosts for it (desktop/Tauri only — see addons-dev-mode.ts).
 */
export const registerDevAddonManifest = async (
  addonId: string,
  manifestJson: string,
): Promise<void> => {
  return invoke<void>("register_dev_addon_manifest", { addonId, manifestJson });
};

export const unregisterDevAddonManifest = async (addonId: string): Promise<void> => {
  return invoke<void>("unregister_dev_addon_manifest", { addonId });
};
