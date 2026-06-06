use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use wealthfolio_core::Result;

use crate::errors::StorageError;
use crate::schema::activities;
use crate::sync::should_sync_outbox_for_activity;

pub(crate) fn should_sync_activity_local_id_outbox(
    conn: &mut SqliteConnection,
    activity_id: &str,
) -> Result<bool> {
    let row = activities::table
        .find(activity_id)
        .select((
            activities::source_system,
            activities::import_run_id,
            activities::source_record_id,
            activities::is_user_modified,
        ))
        .first::<(Option<String>, Option<String>, Option<String>, i32)>(conn)
        .optional()
        .map_err(StorageError::from)?;

    Ok(row.is_none_or(
        |(source_system, import_run_id, source_record_id, is_user_modified)| {
            should_sync_outbox_for_activity(
                source_system.as_deref(),
                is_user_modified != 0,
                import_run_id.as_deref(),
                source_record_id.as_deref(),
            )
        },
    ))
}
