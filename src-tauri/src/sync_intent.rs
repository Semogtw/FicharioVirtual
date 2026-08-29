use rusqlite::{params, Connection};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::{catalog, paths};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadIntentRequest {
    pub document_id: String,
    pub title: Option<String>,
    pub notebook_id: Option<String>,
    pub prompt_version: Option<i64>,
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
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if title.is_some_and(|value| value.len() > 240) {
        return Err("Título de sincronização inválido".into());
    }
    if request
        .notebook_id
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.len() > 128)
    {
        return Err("Caderno de sincronização inválido".into());
    }
    let prompt_version = request.prompt_version.unwrap_or(1);
    if !(1..=10_000).contains(&prompt_version) {
        return Err("Versão de OCR inválida".into());
    }
    catalog::ensure_upload_job(
        &paths::ensure(&app)?,
        &request.document_id,
        title,
        request.notebook_id.as_deref(),
        prompt_version,
    )
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
