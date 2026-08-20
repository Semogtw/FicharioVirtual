use serde::Deserialize;
use tauri::AppHandle;

use crate::{cache, paths};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimCacheRequest {
    pub target_bytes: u64,
}

#[tauri::command]
pub fn trim_native_cache(
    app: AppHandle,
    request: TrimCacheRequest,
) -> Result<cache::CacheTrimResult, String> {
    let paths = paths::ensure(&app)?;
    cache::trim(&paths, request.target_bytes)
}
