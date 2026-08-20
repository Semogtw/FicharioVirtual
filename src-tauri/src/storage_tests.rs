use sha2::{Digest, Sha256};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    catalog::{self, ImportSession},
    paths::AppPaths,
    recovery,
    storage::{self, BeginImportRequest},
};

struct TestStorage {
    paths: AppPaths,
}

impl TestStorage {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "fichario-native-{label}-{}-{nonce}",
            std::process::id()
        ));
        let documents = root.join("documents");
        let staging = root.join("staging");
        fs::create_dir_all(&documents).expect("create documents dir");
        fs::create_dir_all(&staging).expect("create staging dir");
        let paths = AppPaths {
            database: root.join("catalog.sqlite3"),
            root,
            documents,
            staging,
        };
        catalog::initialize(&paths).expect("initialize catalog");
        Self { paths }
    }
}

impl Drop for TestStorage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.paths.root);
    }
}

fn begin_request(document_id: &str, expected_size: usize) -> BeginImportRequest {
    BeginImportRequest {
        document_id: document_id.into(),
        owner_id: "11111111-1111-4111-8111-111111111111".into(),
        original_filename: "arquivo.pdf".into(),
        mime_type: "application/pdf".into(),
        expected_size: expected_size as u64,
        remote_state: Some("pending".into()),
        remote_document_id: None,
        drive_file_id: None,
    }
}

#[test]
fn native_storage_round_trip_protects_unsynced_originals() {
    let storage_root = TestStorage::new("round-trip");
    let paths = &storage_root.paths;
    let data = b"hello local document";

    storage::begin_import(paths, &begin_request("doc-round-trip", data.len()))
        .expect("begin import");
    storage::append_import(paths, "doc-round-trip", &data[..5]).expect("append first chunk");
    storage::append_import(paths, "doc-round-trip", &data[5..]).expect("append second chunk");
    let document = storage::finish_import(paths, "doc-round-trip").expect("finish import");

    assert_eq!(document.remote_state, "pending");
    assert_eq!(
        storage::read_range(paths, "doc-round-trip", 6, 11).expect("read range"),
        b"local"
    );
    assert!(storage::verify_document(paths, "doc-round-trip", true).expect("verify hash"));
    assert!(storage::evict_document(paths, "doc-round-trip").is_err());

    catalog::mark_remote_synced(
        paths,
        "doc-round-trip",
        Some("remote-document"),
        Some("drive-file"),
    )
    .expect("mark synced");
    storage::evict_document(paths, "doc-round-trip").expect("evict synced document");
    assert!(storage::local_document(paths, "doc-round-trip")
        .expect("read evicted state")
        .is_none());
}

#[test]
fn startup_recovery_discards_partial_staging_and_session() {
    let storage_root = TestStorage::new("partial-recovery");
    let paths = &storage_root.paths;

    storage::begin_import(paths, &begin_request("doc-partial", 6)).expect("begin import");
    storage::append_import(paths, "doc-partial", b"abc").expect("append partial chunk");
    assert!(catalog::get_import(paths, "doc-partial")
        .expect("query import")
        .is_some());

    let summary = recovery::recover_abandoned_imports(paths).expect("recover startup");

    assert_eq!(summary.discarded_partial_imports, 1);
    assert!(catalog::get_import(paths, "doc-partial")
        .expect("query recovered import")
        .is_none());
    assert!(!paths.staging.join("doc-partial.part").exists());
}

#[test]
fn startup_recovery_reconstructs_file_moved_before_sqlite_commit() {
    let storage_root = TestStorage::new("moved-recovery");
    let paths = &storage_root.paths;
    let data = b"crash-safe native original";
    let sha256 = format!("{:x}", Sha256::digest(data));
    let document_id = "doc-moved";
    let destination_dir = paths.documents.join(document_id);
    fs::create_dir_all(&destination_dir).expect("create destination dir");
    let destination = destination_dir.join(format!("{sha256}.pdf"));
    fs::write(&destination, data).expect("write moved original");

    catalog::begin_import(
        paths,
        &ImportSession {
            document_id: document_id.into(),
            owner_id: "11111111-1111-4111-8111-111111111111".into(),
            original_filename: "recuperado.pdf".into(),
            mime_type: "application/pdf".into(),
            expected_size: data.len() as i64,
            written_bytes: data.len() as i64,
            staging_relative_path: format!("staging/{document_id}.part"),
            remote_state: "pending".into(),
            remote_document_id: None,
            drive_file_id: None,
        },
    )
    .expect("record interrupted import");

    let summary = recovery::recover_abandoned_imports(paths).expect("recover moved original");
    let document = catalog::get_document(paths, document_id)
        .expect("query recovered document")
        .expect("recovered document exists");

    assert_eq!(summary.recovered_documents, 1);
    assert_eq!(document.sha256, sha256);
    assert_eq!(document.size_bytes, data.len() as i64);
    assert_eq!(document.local_state, "present");
    assert!(catalog::get_import(paths, document_id)
        .expect("query import cleanup")
        .is_none());
    assert_eq!(
        storage::read_range(paths, document_id, 0, data.len() as u64).expect("read recovered file"),
        data
    );
    assert_eq!(
        catalog::list_sync_jobs(paths, 10)
            .expect("query recovery sync job")
            .len(),
        1
    );
}
