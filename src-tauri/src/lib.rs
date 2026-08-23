mod cache;
mod cache_commands;
mod catalog;
mod commands;
mod external;
mod metrics;
mod paths;
mod recovery;
mod secure_storage;
mod storage;
mod sync_intent;

#[cfg(test)]
mod storage_tests;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;

pub(crate) fn sync_once_requested_from<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--sync-once")
}

pub(crate) fn sync_once_requested() -> bool {
    sync_once_requested_from(std::env::args())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sync_once = sync_once_requested();
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::SIZE
                            | tauri_plugin_window_state::StateFlags::POSITION
                            | tauri_plugin_window_state::StateFlags::MAXIMIZED
                            | tauri_plugin_window_state::StateFlags::VISIBLE,
                    )
                    .build(),
            );
    }

    builder = builder.plugin(tauri_plugin_opener::init());

    builder
        .setup(move |app| {
            let paths = paths::ensure(app.handle())
                .map_err(|error| std::io::Error::other(format!("native storage: {error}")))?;
            catalog::initialize(&paths)
                .map_err(|error| std::io::Error::other(format!("native catalog: {error}")))?;
            recovery::recover_abandoned_imports(&paths)
                .map_err(|error| std::io::Error::other(format!("native recovery: {error}")))?;
            storage::reconcile_documents(&paths, false).map_err(|error| {
                std::io::Error::other(format!("native reconciliation: {error}"))
            })?;

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if sync_once {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::native_status,
            commands::native_sync_once_mode,
            commands::finish_native_sync_once,
            commands::begin_local_import,
            commands::append_local_import,
            commands::finish_local_import,
            commands::abort_local_import,
            commands::get_local_document,
            commands::get_local_document_by_drive_file_id,
            commands::list_local_documents,
            commands::list_native_documents_page,
            commands::update_native_document_metadata,
            commands::list_native_document_pages,
            commands::search_native_document_pages,
            commands::read_local_document_range,
            commands::verify_local_document,
            commands::evict_local_document,
            commands::native_disk_usage,
            commands::reconcile_native_documents,
            commands::list_native_sync_jobs,
            commands::claim_native_sync_jobs,
            commands::complete_native_sync_job,
            commands::fail_native_sync_job,
            commands::cancel_native_sync_job,
            commands::mark_native_remote_synced,
            cache_commands::trim_native_cache,
            secure_storage::native_secure_storage_get,
            secure_storage::native_secure_storage_set,
            secure_storage::native_secure_storage_remove,
            sync_intent::ensure_native_upload_intent,
            sync_intent::cancel_native_upload_intent,
            external::open_native_oauth_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fichário Virtual");
}

#[cfg(test)]
mod tests {
    use super::sync_once_requested_from;

    #[test]
    fn recognizes_only_the_explicit_sync_once_flag() {
        assert!(sync_once_requested_from([
            "fichario-native".to_string(),
            "--sync-once".to_string()
        ]));
        assert!(!sync_once_requested_from(["fichario-native".to_string()]));
        assert!(!sync_once_requested_from([
            "fichario-native".to_string(),
            "--sync".to_string()
        ]));
    }
}
