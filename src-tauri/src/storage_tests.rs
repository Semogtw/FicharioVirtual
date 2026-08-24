use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    catalog::{self, ImportSession},
    paths::{self, AppPaths},
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

    assert_eq!(version, 5);
    assert_eq!(migrations, vec![1, 2, 3, 4, 5]);
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

    assert_eq!(version, 5);
    assert_eq!(document.document_id, "doc-legacy");
    assert_eq!(jobs.len(), 1);
    assert!(jobs[0].payload_json.is_some());
}

#[test]
fn existing_v2_catalog_is_upgraded_to_v3_and_keeps_metadata_rows() {
    let storage_root = TestStorage::new("schema-v2-upgrade");
    let paths = &storage_root.paths;
    let data = b"v2 catalog document";

    storage::begin_import(paths, &begin_request("doc-v2", data.len())).expect("begin import");
    storage::append_import(paths, "doc-v2", data).expect("append import");
    storage::finish_import(paths, "doc-v2").expect("finish import");

    let connection = Connection::open(&paths.database).expect("open catalog");
    connection
        .execute_batch("DELETE FROM schema_migrations WHERE version >= 3; DROP TABLE document_pages; PRAGMA user_version = 2;")
        .expect("downgrade fixture to v2 metadata");
    drop(connection);

    catalog::initialize(paths).expect("upgrade v2 catalog");

    let upgraded = Connection::open(&paths.database).expect("reopen catalog");
    let version: i64 = upgraded
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read upgraded version");
    let pages_table: i64 = upgraded
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'document_pages'",
            [],
            |row| row.get(0),
        )
        .expect("inspect page metadata table");
    assert_eq!(version, 5);
    assert_eq!(pages_table, 1);
    assert_eq!(
        catalog::get_document(paths, "doc-v2")
            .expect("read document")
            .unwrap()
            .document_id,
        "doc-v2"
    );
}

#[test]
fn existing_v4_catalog_is_upgraded_to_v5_without_losing_native_text() {
    let storage_root = TestStorage::new("schema-v4-upgrade");
    let paths = &storage_root.paths;
    let data = b"v4 catalog document";
    let owner_id = "11111111-1111-4111-8111-111111111111";

    storage::begin_import(paths, &begin_request("doc-v4", data.len())).expect("begin import");
    storage::append_import(paths, "doc-v4", data).expect("append import");
    storage::finish_import(paths, "doc-v4").expect("finish import");

    let connection = Connection::open(&paths.database).expect("open catalog");
    connection
        .execute(
            "INSERT OR REPLACE INTO document_pages (document_id, page_number, native_text, status, updated_at_ms) VALUES ('doc-v4', 1, 'texto legado', 'ready', 1)",
            [],
        )
        .expect("write v4 page metadata");
    connection
        .execute_batch(
            r#"
PRAGMA foreign_keys = OFF;
CREATE TABLE document_pages_v4 (
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK(page_number >= 1 AND page_number <= 10000),
    native_text TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'ready', 'retryable', 'blocked_quota', 'needs_review', 'failed')),
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(document_id, page_number),
    FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);
INSERT INTO document_pages_v4 (document_id, page_number, native_text, status, updated_at_ms)
SELECT document_id, page_number, native_text, status, updated_at_ms FROM document_pages;
DROP TABLE document_pages;
ALTER TABLE document_pages_v4 RENAME TO document_pages;
CREATE INDEX document_pages_text_idx ON document_pages(document_id, page_number);
DELETE FROM schema_migrations WHERE version >= 5;
PRAGMA user_version = 4;
PRAGMA foreign_keys = ON;
"#,
        )
        .expect("downgrade fixture to v4 metadata");
    drop(connection);

    catalog::initialize(paths).expect("upgrade v4 catalog");

    let upgraded = Connection::open(&paths.database).expect("reopen catalog");
    let version: i64 = upgraded
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read upgraded version");
    let pages = catalog::list_document_pages(paths, "doc-v4", owner_id).expect("read pages");

    assert_eq!(version, 5);
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].native_text.as_deref(), Some("texto legado"));
    assert_eq!(pages[0].ocr_raw_text, None);
    assert_eq!(pages[0].corrected_text, None);
    assert_eq!(pages[0].extraction_source, None);
    assert_eq!(pages[0].ocr_word_geometry_json, "[]");
    assert_eq!(pages[0].warnings_json, "[]");
    assert!(!pages[0].was_manually_reviewed);
    assert_eq!(
        catalog::search_document_pages(paths, owner_id, "legado", 10, 0, None)
            .expect("search upgraded page")
            .len(),
        1
    );
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

    assert!(
        catalog::ensure_upload_job(paths, "doc-payload-repair", None, None, 1)
            .expect("reassert upload job")
    );
    let preserved_job = catalog::list_sync_jobs(paths, 10)
        .expect("list preserved jobs")
        .into_iter()
        .find(|candidate| candidate.document_id == "doc-payload-repair")
        .expect("preserved upload job exists");
    let preserved_payload: serde_json::Value = serde_json::from_str(
        preserved_job
            .payload_json
            .as_deref()
            .expect("preserved payload exists"),
    )
    .expect("valid preserved payload");
    assert_eq!(preserved_payload["title"], "Caderno recuperado");
    assert_eq!(preserved_payload["notebookId"], "notebook-1");
    assert_eq!(preserved_payload["promptVersion"], 3);
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
fn native_document_metadata_round_trip_replaces_page_snapshot_and_checks_owner() {
    let storage_root = TestStorage::new("document-metadata");
    let paths = &storage_root.paths;
    let data = b"document metadata";
    let owner_id = "11111111-1111-4111-8111-111111111111";

    storage::begin_import(paths, &begin_request("doc-metadata", data.len())).expect("begin import");
    storage::append_import(paths, "doc-metadata", data).expect("append import");
    storage::finish_import(paths, "doc-metadata").expect("finish import");

    catalog::update_document_metadata(
        paths,
        "doc-metadata",
        catalog::DocumentMetadataInput {
            owner_id: owner_id.into(),
            title: "Caderno local".into(),
            notebook_id: Some("notebook-local".into()),
            page_count: 2,
            status: "processing".into(),
            pages: vec![
                catalog::DocumentPageMetadataInput {
                    page_number: 1,
                    native_text: Some("primeira página".into()),
                    ocr_raw_text: Some("texto OCR".into()),
                    corrected_text: Some("texto corrigido".into()),
                    extraction_source: Some("ocr".into()),
                    ocr_word_geometry_json:
                        r#"[{"text":"texto","left":10,"top":20,"right":80,"bottom":50}]"#.into(),
                    warnings_json: r#"[{"code":"ocr_review","message":"Revisar"}]"#.into(),
                    was_manually_reviewed: true,
                },
                catalog::DocumentPageMetadataInput {
                    page_number: 2,
                    native_text: None,
                    ocr_raw_text: None,
                    corrected_text: None,
                    extraction_source: None,
                    ocr_word_geometry_json: "[]".into(),
                    warnings_json: "[]".into(),
                    was_manually_reviewed: false,
                },
            ],
        },
    )
    .expect("save metadata");
    let document = catalog::get_document(paths, "doc-metadata")
        .expect("read metadata document")
        .expect("metadata document exists");
    assert_eq!(document.title.as_deref(), Some("Caderno local"));
    assert_eq!(document.notebook_id.as_deref(), Some("notebook-local"));
    assert_eq!(document.page_count, 2);
    assert_eq!(document.status.as_deref(), Some("processing"));
    let pages = catalog::list_document_pages(paths, "doc-metadata", owner_id).expect("read pages");
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[0].native_text.as_deref(), Some("primeira página"));
    assert_eq!(pages[0].ocr_raw_text.as_deref(), Some("texto OCR"));
    assert_eq!(pages[0].corrected_text.as_deref(), Some("texto corrigido"));
    assert_eq!(pages[0].extraction_source.as_deref(), Some("ocr"));
    assert!(pages[0].was_manually_reviewed);
    assert_eq!(pages[1].status, "processing");
    let search = catalog::search_document_pages(paths, owner_id, "corrigido", 10, 0, None)
        .expect("search local page text");
    assert_eq!(search.len(), 1);
    assert_eq!(search[0].page_number, 1);

    catalog::update_document_metadata(
        paths,
        "doc-metadata",
        catalog::DocumentMetadataInput {
            owner_id: owner_id.into(),
            title: "Caderno atualizado".into(),
            notebook_id: None,
            page_count: 1,
            status: "ready".into(),
            pages: vec![catalog::DocumentPageMetadataInput {
                page_number: 1,
                native_text: Some("página atualizada".into()),
                ocr_raw_text: None,
                corrected_text: None,
                extraction_source: Some("native_pdf".into()),
                ocr_word_geometry_json: "[]".into(),
                warnings_json: "[]".into(),
                was_manually_reviewed: false,
            }],
        },
    )
    .expect("replace metadata");
    let replaced =
        catalog::list_document_pages(paths, "doc-metadata", owner_id).expect("read replaced pages");
    assert_eq!(replaced.len(), 1);
    assert_eq!(
        replaced[0].native_text.as_deref(),
        Some("página atualizada")
    );
    assert!(
        catalog::search_document_pages(paths, owner_id, "primeira", 10, 0, None)
            .expect("search replaced page text")
            .is_empty()
    );
    assert!(
        catalog::list_document_pages(paths, "doc-metadata", "different-owner")
            .expect("read pages for different owner")
            .is_empty()
    );
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

#[test]
fn catalog_reconciliation_marks_missing_documents_without_promoting_files() {
    let storage_root = TestStorage::new("reconcile-missing");
    let paths = &storage_root.paths;
    let data = b"document to reconcile";

    storage::begin_import(paths, &begin_request("doc-reconcile-missing", data.len()))
        .expect("begin import");
    storage::append_import(paths, "doc-reconcile-missing", data).expect("append import");
    let document = storage::finish_import(paths, "doc-reconcile-missing").expect("finish import");
    let document_path = paths::resolve_relative(&paths.root, &document.relative_path)
        .expect("resolve document path");
    fs::remove_file(document_path).expect("remove document for reconciliation");

    let summary = storage::reconcile_documents(paths, false).expect("reconcile catalog");
    let reconciled = catalog::get_document(paths, "doc-reconcile-missing")
        .expect("read reconciled document")
        .expect("reconciled document exists");

    assert_eq!(summary.inspected_documents, 1);
    assert_eq!(summary.missing_documents, 1);
    assert_eq!(summary.corrupt_documents, 0);
    assert_eq!(reconciled.local_state, "missing");
}

#[test]
fn catalog_reconciliation_detects_same_size_corruption_when_hash_requested() {
    let storage_root = TestStorage::new("reconcile-corrupt");
    let paths = &storage_root.paths;
    let data = b"original bytes";

    storage::begin_import(paths, &begin_request("doc-reconcile-corrupt", data.len()))
        .expect("begin import");
    storage::append_import(paths, "doc-reconcile-corrupt", data).expect("append import");
    let document = storage::finish_import(paths, "doc-reconcile-corrupt").expect("finish import");
    let document_path = paths::resolve_relative(&paths.root, &document.relative_path)
        .expect("resolve document path");
    fs::write(document_path, b"mutated bytes!").expect("mutate document without changing size");

    let summary = storage::reconcile_documents(paths, true).expect("reconcile catalog");
    let reconciled = catalog::get_document(paths, "doc-reconcile-corrupt")
        .expect("read reconciled document")
        .expect("reconciled document exists");

    assert_eq!(summary.inspected_documents, 1);
    assert_eq!(summary.missing_documents, 0);
    assert_eq!(summary.corrupt_documents, 1);
    assert_eq!(reconciled.local_state, "corrupt");
}

#[test]
fn catalog_document_pages_resume_with_a_cursor_without_dropping_documents() {
    let storage_root = TestStorage::new("document-pages");
    let paths = &storage_root.paths;

    for (document_id, data) in [
        ("doc-page-a", b"page a".as_slice()),
        ("doc-page-b", b"page b".as_slice()),
        ("doc-page-c", b"page c".as_slice()),
    ] {
        storage::begin_import(paths, &begin_request(document_id, data.len()))
            .expect("begin import");
        storage::append_import(paths, document_id, data).expect("append import");
        storage::finish_import(paths, document_id).expect("finish import");
    }

    let first = catalog::list_documents_page(paths, 2, None).expect("read first page");
    let first_ids: Vec<_> = first
        .documents
        .iter()
        .map(|document| document.document_id.as_str())
        .collect();
    let cursor = first.next_cursor.expect("first page has a cursor");
    let second = catalog::list_documents_page(paths, 2, Some(&cursor)).expect("read second page");
    let second_ids: Vec<_> = second
        .documents
        .iter()
        .map(|document| document.document_id.as_str())
        .collect();

    assert_eq!(first.documents.len(), 2);
    assert_eq!(second.documents.len(), 1);
    assert!(second.next_cursor.is_none());
    assert!(first_ids.iter().all(|id| !second_ids.contains(id)));
    assert_eq!(first_ids.len() + second_ids.len(), 3);
}

#[test]
fn catalog_reads_one_page_with_owner_scope_without_listing_the_snapshot() {
    let storage_root = TestStorage::new("single-document-page");
    let paths = &storage_root.paths;
    let owner_id = "11111111-1111-4111-8111-111111111111";
    let data = b"document page metadata";

    storage::begin_import(paths, &begin_request("doc-single-page", data.len()))
        .expect("begin import");
    storage::append_import(paths, "doc-single-page", data).expect("append import");
    storage::finish_import(paths, "doc-single-page").expect("finish import");
    catalog::update_document_metadata(
        paths,
        "doc-single-page",
        catalog::DocumentMetadataInput {
            owner_id: owner_id.into(),
            title: "Documento local".into(),
            notebook_id: None,
            page_count: 2,
            status: "ready".into(),
            pages: vec![
                catalog::DocumentPageMetadataInput {
                    page_number: 1,
                    native_text: Some("primeira página".into()),
                    ocr_raw_text: None,
                    corrected_text: None,
                    extraction_source: Some("native_pdf".into()),
                    ocr_word_geometry_json: "[]".into(),
                    warnings_json: "[]".into(),
                    was_manually_reviewed: false,
                },
                catalog::DocumentPageMetadataInput {
                    page_number: 2,
                    native_text: Some("segunda página".into()),
                    ocr_raw_text: None,
                    corrected_text: None,
                    extraction_source: Some("native_pdf".into()),
                    ocr_word_geometry_json: "[]".into(),
                    warnings_json: "[]".into(),
                    was_manually_reviewed: false,
                },
            ],
        },
    )
    .expect("write page snapshot");

    let page = catalog::get_document_page(paths, "doc-single-page", owner_id, 2)
        .expect("read one page")
        .expect("page exists");

    assert_eq!(page.page_number, 2);
    assert_eq!(page.native_text.as_deref(), Some("segunda página"));
    assert!(
        catalog::get_document_page(paths, "doc-single-page", "other-owner", 2)
            .expect("check other owner")
            .is_none()
    );
    assert!(
        catalog::get_document_page(paths, "doc-single-page", owner_id, 3)
            .expect("check missing page")
            .is_none()
    );
}
