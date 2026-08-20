mod cache;
mod cache_commands;
mod catalog;
mod commands;
mod external;
mod metrics;
mod paths;
mod recovery;
mod storage;
mod sync_intent;

#[cfg(test)]
mod storage_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = paths::ensure(app.handle())
                .map_err(|error| std::io::Error::other(format!("native storage: {error}")))?;
            catalog::initialize(&paths)
                .map_err(|error| std::io::Error::other(format!("native catalog: {error}")))?;
            recovery::recover_abandoned_imports(&paths)
                .map_err(|error| std::io::Error::other(format!("native recovery: {error}")))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::native_status,
            commands::begin_local_import,
            commands::append_local_import,
            commands::finish_local_import,
            commands::abort_local_import,
            commands::get_local_document,
            commands::get_local_document_by_drive_file_id,
            commands::list_local_documents,
            commands::read_local_document_range,
            commands::verify_local_document,
            commands::evict_local_document,
            commands::native_disk_usage,
            commands::list_native_sync_jobs,
            commands::claim_native_sync_jobs,
            commands::complete_native_sync_job,
            commands::fail_native_sync_job,
            commands::mark_native_remote_synced,
            cache_commands::trim_native_cache,
            sync_intent::ensure_native_upload_intent,
            sync_intent::cancel_native_upload_intent,
            external::open_native_oauth_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fichário Virtual");
}
