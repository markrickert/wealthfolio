use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt::Write;
use wealthfolio_core::errors::{DatabaseError, Error};
use wealthfolio_core::sync::{SyncEntity, SyncOperation};
use wealthfolio_core::Result;

use crate::activities::ActivityDB;
use crate::sync::OutboxWriteRequest;

const ENTITY_ID_PREFIX: &str = "broker_activity_patch:";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BrokerActivityIdentity {
    pub source_system: String,
    pub provider_account_id: String,
    pub source_record_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerActivityUserPatchPayload {
    #[serde(alias = "source_system")]
    pub source_system: String,
    #[serde(alias = "provider_account_id")]
    pub provider_account_id: String,
    #[serde(alias = "source_record_id")]
    pub source_record_id: String,
    pub overlay: BrokerActivityUserOverlay,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerActivityUserOverlay {
    pub notes: Option<String>,
    #[serde(default)]
    #[serde(alias = "activity_type_override")]
    pub activity_type_override: Option<String>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    #[serde(alias = "needs_review")]
    pub needs_review: bool,
}

pub(crate) fn broker_activity_identity(
    source_system: Option<&str>,
    provider_account_id: Option<&str>,
    source_record_id: Option<&str>,
) -> Option<BrokerActivityIdentity> {
    let source_system = normalize_source_system(source_system?)?;
    if matches!(source_system.as_str(), "MANUAL" | "CSV") {
        return None;
    }

    Some(BrokerActivityIdentity {
        source_system,
        provider_account_id: normalize_required(provider_account_id?)?,
        source_record_id: normalize_required(source_record_id?)?,
    })
}

pub(crate) fn broker_activity_user_patch_entity_id(identity: &BrokerActivityIdentity) -> String {
    let mut hasher = Sha256::new();
    hash_component(&mut hasher, &identity.source_system);
    hash_component(&mut hasher, &identity.provider_account_id);
    hash_component(&mut hasher, &identity.source_record_id);
    let digest = hasher.finalize();
    format!("{ENTITY_ID_PREFIX}{}", hex_prefix(&digest, 32))
}

pub(crate) fn broker_activity_user_patch_request(
    activity: &ActivityDB,
    provider_account_id: Option<&str>,
) -> Result<Option<OutboxWriteRequest>> {
    let Some(identity) = broker_activity_identity(
        activity.source_system.as_deref(),
        provider_account_id,
        activity.source_record_id.as_deref(),
    ) else {
        return Ok(None);
    };

    let payload = BrokerActivityUserPatchPayload {
        source_system: identity.source_system.clone(),
        provider_account_id: identity.provider_account_id.clone(),
        source_record_id: identity.source_record_id.clone(),
        overlay: BrokerActivityUserOverlay {
            notes: activity.notes.clone(),
            activity_type_override: normalize_optional(activity.activity_type_override.as_deref()),
            subtype: normalize_optional(activity.subtype.as_deref()),
            needs_review: activity.needs_review != 0,
        },
    };

    Ok(Some(OutboxWriteRequest::new(
        SyncEntity::BrokerActivityUserPatch,
        broker_activity_user_patch_entity_id(&identity),
        SyncOperation::Update,
        serde_json::to_value(payload)?,
    )))
}

pub(crate) fn broker_activity_user_overlay_changed(
    before: &ActivityDB,
    after: &ActivityDB,
) -> bool {
    before.notes != after.notes
        || normalize_optional(before.activity_type_override.as_deref())
            != normalize_optional(after.activity_type_override.as_deref())
        || normalize_optional(before.subtype.as_deref())
            != normalize_optional(after.subtype.as_deref())
        || before.needs_review != after.needs_review
}

pub(crate) fn parse_broker_activity_user_patch_payload(
    payload: &serde_json::Value,
) -> Result<BrokerActivityUserPatchPayload> {
    let mut parsed = serde_json::from_value::<BrokerActivityUserPatchPayload>(payload.clone())?;
    let Some(identity) = broker_activity_identity(
        Some(&parsed.source_system),
        Some(&parsed.provider_account_id),
        Some(&parsed.source_record_id),
    ) else {
        return Err(Error::Database(DatabaseError::Internal(
            "Invalid broker activity user patch identity".to_string(),
        )));
    };

    parsed.source_system = identity.source_system;
    parsed.provider_account_id = identity.provider_account_id;
    parsed.source_record_id = identity.source_record_id;
    parsed.overlay.activity_type_override =
        normalize_optional(parsed.overlay.activity_type_override.as_deref());
    parsed.overlay.subtype = normalize_optional(parsed.overlay.subtype.as_deref());
    Ok(parsed)
}

fn normalize_source_system(value: &str) -> Option<String> {
    normalize_required(value).map(|source| source.to_ascii_uppercase())
}

fn normalize_required(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_optional(value: Option<&str>) -> Option<String> {
    value.and_then(normalize_required)
}

fn hash_component(hasher: &mut Sha256, value: &str) {
    hasher.update(value.len().to_string().as_bytes());
    hasher.update(b":");
    hasher.update(value.as_bytes());
    hasher.update(b";");
}

fn hex_prefix(bytes: &[u8], chars: usize) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut out, "{byte:02x}").expect("hex formatting should not fail");
    }
    out.truncate(chars);
    out
}
