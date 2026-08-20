use serde::{Deserialize, Serialize};
use tauri::{ipc::Response, AppHandle};

use crate::{catalog, metrics, paths, storage};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStatus {
    pub platform: String,
    pub schema_version: u32,
    pub local_document_count: usize,
    pub pending_sync_count: usize,
    pub disk_usage_bytes: u64,
    pub max_document_bytes: u64,
    pub max_ipc_chunk_bytes: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDocument {
    pub document_id: String,
    pub owner_id: String,
    pub original_filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub local_state: String,
    pub remote_state: String,
    pub remote_document_id: Option<String>,
    pub drive_file_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_accessed_at_ms: i64,
}

impl TryFrom<catalog::DocumentRow> for NativeDocument {
    type Error = String;

    fn try_from(value: catalog::DocumentRow) -> Result<Self, Self::Error> {
        Ok(Self {
            document_id: value.document_id,
            owner_id: value.owner_id,
            original_filename: value.original_filename,
            mime_type: value.mime_type,
            size_bytes: u64::try_from(value.size_bytes).map_err(|_| "Tamanho local inválido")?,
            sha256: value.sha256,
            local_state: value.local_state,
            remote_state: value.remote_state,
            remote_document_id: value.remote_document_id,
            drive_file_id: value.drive_file_id,
            created_at_ms: value.created_at_ms,
            updated_at_ms: value.updated_at_ms,
            last_accessed_at_ms: value.last_accessed_at_ms,
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRequest {
    pub document_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFileRequest {
    pub drive_file_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendImportRequest {
    pub document_id: String,
    pub chunk: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRangeRequest {
    pub document_id: String,
    pub start: u64,
    pub end_exclusive: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyDocumentRequest {
    pub document_id: String,
    pub full_hash: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimSyncRequest {
    pub limit: Option<usize>,
    pub lease_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncJobRequest {
    pub id: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailSyncJobRequest {
    pub id: i64,
    pub error: String,
    pub retry_after_ms: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkRemoteSyncedRequest {
    pub document_id: String,
    pub remote_document_id: Option<String>,
    pub drive_file_id: Option<String>,
}

fn app_paths(app: &AppHandle) -> Result<paths::AppPaths, String> {
    paths::ensure(app)
}

#[tauri::command]
pub fn native_status(app: AppHandle) -> Result<NativeStatus, String> {
    let paths = app_paths(&app)?;
    let summary = metrics::read(&paths)?;
    Ok(NativeStatus {
        platform: std::env::consts::OS.to_string(),
        schema_version: 1,
        local_document_count: summary.present_document_count,
        pending_sync_count: summary.pending_sync_count,
        disk_usage_bytes: summary
            .present_document_bytes
            .saturating_add(summary.staging_bytes),
        max_document_bytes: paths::MAX_NATIVE_DOCUMENT_BYTES,
        max_ipc_chunk_bytes: storage::MAX_IPC_CHUNK_BYTES,
    })
}

#[tauri::command]
pub fn begin_local_import(
    app: AppHandle,
    request: storage::BeginImportRequest,
) -> Result<(), String> {
    storage::begin_import(&app_paths(&app)?, &request)
}

#[tauri::command]
pub fn append_local_import(app: AppHandle, request: AppendImportRequest) -> Result<u64, String> {
    storage::append_import(&app_paths(&app)?, &request.document_id, &request.chunk)
}

#[tauri::command]
pub fn finish_local_import(
    app: AppHandle,
    request: DocumentRequest,
) -> Result<NativeDocument, String> {
    storage::finish_import(&app_paths(&app)?, &request.document_id)?.try_into()
}

#[tauri::command]
pub fn abort_local_import(app: AppHandle, request: DocumentRequest) -> Result<(), String> {
    storage::abort_import(&app_paths(&app)?, &request.document_id)
}

#[tauri::command]
pub fn get_local_document(
    app: AppHandle,
    request: DocumentRequest,
) -> Result<Option<NativeDocument>, String> {
    storage::local_document(&app_paths(&app)?, &request.document_id)?
        .map(TryInto::try_into)
        .transpose()
}

#[tauri::command]
pub fn get_local_document_by_drive_file_id(
    app: AppHandle,
    request: DriveFileRequest,
) -> Result<Option<NativeDocument>, String> {
    storage::local_document_by_drive_file_id(&app_paths(&app)?, &request.drive_file_id)?
        .map(TryInto::try_into)
        .transpose()
}

#[tauri::command]
pub fn list_local_documents(
    app: AppHandle,
    request: ListRequest,
) -> Result<Vec<NativeDocument>, String> {
    catalog::list_documents(
        &app_paths(&app)?,
        request.limit.unwrap_or(200).clamp(1, 1000),
    )?
    .into_iter()
    .map(TryInto::try_into)
    .collect()
}

#[tauri::command]
pub fn read_local_document_range(
    app: AppHandle,
    request: ReadRangeRequest,
) -> Result<Response, String> {
    let bytes = storage::read_range(
        &app_paths(&app)?,
        &request.document_id,
        request.start,
        request.end_exclusive,
    )?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn verify_local_document(
    app: AppHandle,
    request: VerifyDocumentRequest,
) -> Result<bool, String> {
    storage::verify_document(&app_paths(&app)?, &request.document_id, request.full_hash)
}

#[tauri::command]
pub fn evict_local_document(app: AppHandle, request: DocumentRequest) -> Result<(), String> {
    storage::evict_document(&app_paths(&app)?, &request.document_id)
}

#[tauri::command]
pub fn native_disk_usage(app: AppHandle) -> Result<u64, String> {
    metrics::disk_usage_bytes(&app_paths(&app)?)
}

#[tauri::command]
pub fn list_native_sync_jobs(
    app: AppHandle,
    request: ListRequest,
) -> Result<Vec<catalog::SyncJob>, String> {
    catalog::list_sync_jobs(&app_paths(&app)?, request.limit.unwrap_or(50).clamp(1, 100))
}

#[tauri::command]
pub fn claim_native_sync_jobs(
    app: AppHandle,
    request: ClaimSyncRequest,
) -> Result<Vec<catalog::SyncJob>, String> {
    catalog::claim_sync_jobs(
        &app_paths(&app)?,
        request.limit.unwrap_or(2),
        request.lease_ms.unwrap_or(60_000),
    )
}

#[tauri::command]
pub fn complete_native_sync_job(app: AppHandle, request: SyncJobRequest) -> Result<(), String> {
    catalog::complete_sync_job(&app_paths(&app)?, request.id)
}

#[tauri::command]
pub fn fail_native_sync_job(app: AppHandle, request: FailSyncJobRequest) -> Result<(), String> {
    catalog::fail_sync_job(
        &app_paths(&app)?,
        request.id,
        &request.error,
        request.retry_after_ms,
    )
}

#[tauri::command]
pub fn mark_native_remote_synced(
    app: AppHandle,
    request: MarkRemoteSyncedRequest,
) -> Result<(), String> {
    paths::validate_document_id(&request.document_id)?;
    catalog::mark_remote_synced(
        &app_paths(&app)?,
        &request.document_id,
        request.remote_document_id.as_deref(),
        request.drive_file_id.as_deref(),
    )
}
