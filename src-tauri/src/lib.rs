mod catalog;
mod commands;
mod paths;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let paths = paths::ensure(app.handle())
                .map_err(|error| std::io::Error::other(format!("native storage: {error}")))?;
            catalog::initialize(&paths)
                .map_err(|error| std::io::Error::other(format!("native catalog: {error}")))?;
            storage::cleanup_staging(&paths)
                .map_err(|error| std::io::Error::other(format!("native staging: {error}")))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::native_status,
            commands::begin_local_import,
            commands::append_local_import,
            commands::finish_local_import,
            commands::abort_local_import,
            commands::get_local_document,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fichário Virtual");
}
