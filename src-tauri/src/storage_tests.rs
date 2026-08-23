use rusqlite::Connection;
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

#[test]
fn catalog_records_explicit_schema_migrations_and_payload_column() {
    let storage_root = TestStorage::new("schema-migrations");
    let connection = Connection::open(&storage_root.paths.database).expect("open catalog");

    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read schema version");
    let migrations: Vec<i64> = {
        let mut statement = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version")
            .expect("prepare migration query");
        statement
            .query_map([], |row| row.get(0))
            .expect("query migrations")
            .collect::<Result<Vec<_>, _>>()
            .expect("read migrations")
    };
    let payload_columns: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sync_jobs') WHERE name = 'payload_json'",
            [],
            |row| row.get(0),
        )
        .expect("inspect sync job schema");

    assert_eq!(version, 2);
    assert_eq!(migrations, vec![1, 2]);
    assert_eq!(payload_columns, 1);
}

#[test]
fn existing_v1_catalog_is_upgraded_without_losing_documents_or_jobs() {
    let storage_root = TestStorage::new("schema-upgrade");
    let paths = &storage_root.paths;
    let data = b"legacy catalog document";

    storage::begin_import(paths, &begin_request("doc-legacy", data.len())).expect("begin import");
    storage::append_import(paths, "doc-legacy", data).expect("append import");
    storage::finish_import(paths, "doc-legacy").expect("finish import");

    let connection = Connection::open(&storage_root.paths.database).expect("open catalog");
    connection
        .execute_batch("DROP TABLE schema_migrations; PRAGMA user_version = 1;")
        .expect("downgrade fixture to legacy v1 metadata");
    drop(connection);

    catalog::initialize(paths).expect("upgrade legacy catalog");

    let upgraded_connection =
        Connection::open(&storage_root.paths.database).expect("reopen catalog");
    let version: i64 = upgraded_connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read upgraded version");
    let document = catalog::get_document(paths, "doc-legacy")
        .expect("read upgraded document")
        .expect("legacy document survives");
    let jobs = catalog::list_sync_jobs(paths, 10).expect("read upgraded jobs");

    assert_eq!(version, 2);
    assert_eq!(document.document_id, "doc-legacy");
    assert_eq!(jobs.len(), 1);
    assert!(jobs[0].payload_json.is_some());
}

#[test]
fn reasserting_an_upload_intent_rebuilds_a_missing_payload() {
    let storage_root = TestStorage::new("payload-repair");
    let paths = &storage_root.paths;
    let data = b"payload repair document";

    storage::begin_import(paths, &begin_request("doc-payload-repair", data.len()))
        .expect("begin import");
    storage::append_import(paths, "doc-payload-repair", data).expect("append import");
    storage::finish_import(paths, "doc-payload-repair").expect("finish import");

    let connection = Connection::open(&paths.database).expect("open catalog");
    connection
        .execute(
            "UPDATE sync_jobs SET payload_json = NULL WHERE document_id = ?1",
            ["doc-payload-repair"],
        )
        .expect("clear upload payload");
    drop(connection);

    assert!(catalog::ensure_upload_job(
        paths,
        "doc-payload-repair",
        Some("Caderno recuperado"),
        Some("notebook-1"),
        3,
    )
    .expect("repair upload job"));
    let job = catalog::list_sync_jobs(paths, 10)
        .expect("list repaired jobs")
        .into_iter()
        .find(|candidate| candidate.document_id == "doc-payload-repair")
        .expect("repaired upload job exists");
    let payload: serde_json::Value = serde_json::from_str(
        job.payload_json
            .as_deref()
            .expect("repaired payload exists"),
    )
    .expect("valid repaired payload");

    assert_eq!(payload["kind"], "upload_original");
    assert_eq!(payload["documentId"], "doc-payload-repair");
    assert_eq!(payload["title"], "Caderno recuperado");
    assert_eq!(payload["notebookId"], "notebook-1");
    assert_eq!(payload["promptVersion"], 3);
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
    let upload_job = catalog::list_sync_jobs(paths, 10)
        .expect("list upload jobs")
        .into_iter()
        .find(|job| job.document_id == "doc-round-trip")
        .expect("upload job exists");
    let payload: serde_json::Value = serde_json::from_str(
        upload_job
            .payload_json
            .as_deref()
            .expect("upload payload exists"),
    )
    .expect("valid upload payload");
    assert_eq!(payload["kind"], "upload_original");
    assert_eq!(payload["documentId"], "doc-round-trip");
    assert_eq!(payload["title"], "arquivo.pdf");
    assert_eq!(payload["notebookId"], serde_json::Value::Null);
    assert_eq!(payload["promptVersion"], 1);
    assert_eq!(payload["mimeType"], "application/pdf");
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
