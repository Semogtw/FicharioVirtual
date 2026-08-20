use rusqlite::{params, Connection};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::paths;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIntentRequest {
    pub document_id: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    let app_paths = paths::ensure(app)?;
    let connection = Connection::open(&app_paths.database)
        .map_err(|error| format!("Não foi possível abrir a fila local: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Não foi possível configurar a fila local: {error}"))?;
    Ok(connection)
}

#[tauri::command]
pub fn ensure_native_upload_intent(
    app: AppHandle,
    request: UploadIntentRequest,
) -> Result<bool, String> {
    paths::validate_document_id(&request.document_id)?;
    let connection = open(&app)?;
    let now = now_ms();
    let changed = connection
        .execute(
            r#"INSERT INTO sync_jobs (
                document_id, operation, state, priority, attempts, next_attempt_at_ms,
                lease_until_ms, last_error, created_at_ms, updated_at_ms
            )
            SELECT document_id, 'upload', 'pending', 50, 0, 0, NULL, NULL, ?2, ?2
            FROM documents
            WHERE document_id = ?1 AND remote_state = 'pending'
            ON CONFLICT(document_id, operation) WHERE state IN ('pending', 'running', 'retry')
            DO UPDATE SET priority = MAX(priority, excluded.priority), updated_at_ms = excluded.updated_at_ms"#,
            params![request.document_id, now],
        )
        .map_err(|error| format!("Não foi possível registrar a sincronização local: {error}"))?;
    Ok(changed > 0)
}

#[tauri::command]
pub fn cancel_native_upload_intent(
    app: AppHandle,
    request: UploadIntentRequest,
) -> Result<bool, String> {
    paths::validate_document_id(&request.document_id)?;
    let connection = open(&app)?;
    let changed = connection
        .execute(
            r#"UPDATE sync_jobs
            SET state = 'cancelled', lease_until_ms = NULL, updated_at_ms = ?2
            WHERE document_id = ?1
              AND operation = 'upload'
              AND state IN ('pending', 'running', 'retry')"#,
            params![request.document_id, now_ms()],
        )
        .map_err(|error| format!("Não foi possível cancelar a sincronização local: {error}"))?;
    Ok(changed > 0)
}
