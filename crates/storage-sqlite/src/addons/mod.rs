//! Storage for durable per-addon key-value data.
//!
//! Local-only table today (no device-sync outbox participation); syncing addon
//! storage is a planned follow-up. Reads go through the pool, writes are
//! serialized on the `WriteHandle` like the other repositories.

pub mod storage;

pub use storage::{AddonStorageDB, AddonStorageRepository};
