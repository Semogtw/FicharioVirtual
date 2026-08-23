use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::paths::AppPaths;

#[derive(Clone, Debug)]
pub struct DocumentRow {
    pub document_id: String,
    pub owner_id: String,
    pub original_filename: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub relative_path: String,
    pub local_state: String,
    pub remote_state: String,
    pub remote_document_id: Option<String>,
    pub drive_file_id: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub last_accessed_at_ms: i64,
    pub title: Option<String>,
    pub notebook_id: Option<String>,
    pub page_count: i64,
    pub status: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DocumentPageMetadataRow {
    pub document_id: String,
    pub page_number: i64,
    pub native_text: Option<String>,
    pub ocr_raw_text: Option<String>,
    pub corrected_text: Option<String>,
    pub extraction_source: Option<String>,
    pub ocr_word_geometry_json: String,
    pub warnings_json: String,
    pub was_manually_reviewed: bool,
    pub status: String,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug)]
pub struct DocumentPageMetadataInput {
    pub page_number: i64,
    pub native_text: Option<String>,
    pub ocr_raw_text: Option<String>,
    pub corrected_text: Option<String>,
    pub extraction_source: Option<String>,
    pub ocr_word_geometry_json: String,
    pub warnings_json: String,
    pub was_manually_reviewed: bool,
}

#[derive(Clone, Debug)]
pub struct DocumentSearchPageRow {
    pub document_id: String,
    pub document_title: String,
    pub notebook_id: Option<String>,
    pub page_number: i64,
    pub native_text: String,
    pub rank: f64,
}

#[derive(Clone, Debug)]
pub struct DocumentMetadataInput {
    pub owner_id: String,
    pub title: String,
    pub notebook_id: Option<String>,
    pub page_count: i64,
    pub status: String,
    pub pages: Vec<DocumentPageMetadataInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPageCursor {
    pub last_accessed_at_ms: i64,
    pub document_id: String,
}

#[derive(Clone, Debug)]
pub struct DocumentPage {
    pub documents: Vec<DocumentRow>,
    pub next_cursor: Option<DocumentPageCursor>,
}

#[derive(Clone, Debug)]
pub struct ImportSession {
    pub document_id: String,
    pub owner_id: String,
    pub original_filename: String,
    pub mime_type: String,
    pub expected_size: i64,
    pub written_bytes: i64,
    pub staging_relative_path: String,
    pub remote_state: String,
    pub remote_document_id: Option<String>,
    pub drive_file_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncJob {
    pub id: i64,
    pub document_id: String,
    pub operation: String,
    pub state: String,
    pub priority: i64,
    pub attempts: i64,
    pub next_attempt_at_ms: i64,
    pub lease_until_ms: Option<i64>,
    pub last_error: Option<String>,
    pub payload_json: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn open(paths: &AppPaths) -> Result<Connection, String> {
    let connection = Connection::open(&paths.database)
        .map_err(|error| format!("Não foi possível abrir o catálogo local: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Não foi possível configurar o catálogo local: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;\nPRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;",
        )
        .map_err(|error| format!("Não foi possível configurar o catálogo local: {error}"))?;
    Ok(connection)
}

pub fn initialize(paths: &AppPaths) -> Result<(), String> {
    let mut connection = open(paths)?;
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("Não foi possível ler a versão do catálogo local: {error}"))?;
    if version > 5 {
        return Err(format!(
            "Catálogo local criado por uma versão mais nova do Fichário (schema {version})"
        ));
    }
    if version == 5 {
        reset_abandoned_sync_jobs(paths)?;
        return Ok(());
    }
    if version == 4 {
        migrate_to_v5(&mut connection)?;
        reset_abandoned_sync_jobs(paths)?;
        return Ok(());
    }
    if version == 3 {
        migrate_to_v4(&mut connection)?;
        migrate_to_v5(&mut connection)?;
        reset_abandoned_sync_jobs(paths)?;
        return Ok(());
    }
    if version == 2 {
        migrate_to_v3(&mut connection)?;
        migrate_to_v4(&mut connection)?;
        migrate_to_v5(&mut connection)?;
        reset_abandoned_sync_jobs(paths)?;
        return Ok(());
    }
    if version == 1 {
        migrate_to_v2(&mut connection)?;
        migrate_to_v3(&mut connection)?;
        migrate_to_v4(&mut connection)?;
        migrate_to_v5(&mut connection)?;
        reset_abandoned_sync_jobs(paths)?;
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("Não foi possível iniciar a migração local: {error}"))?;
    transaction
        .execute_batch(
            r#"
CREATE TABLE documents (
    document_id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    sha256 TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    local_state TEXT NOT NULL CHECK(local_state IN ('present', 'missing', 'corrupt')),
    remote_state TEXT NOT NULL CHECK(remote_state IN ('pending', 'synced', 'remote-only')),
    remote_document_id TEXT,
    drive_file_id TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    last_accessed_at_ms INTEGER NOT NULL
);
CREATE INDEX documents_local_state_idx ON documents(local_state, last_accessed_at_ms DESC);
CREATE INDEX documents_remote_idx ON documents(remote_document_id);
CREATE INDEX documents_drive_file_idx ON documents(drive_file_id);

CREATE TABLE import_sessions (
    document_id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    expected_size INTEGER NOT NULL CHECK(expected_size >= 0),
    written_bytes INTEGER NOT NULL DEFAULT 0 CHECK(written_bytes >= 0),
    staging_relative_path TEXT NOT NULL,
    remote_state TEXT NOT NULL CHECK(remote_state IN ('pending', 'synced')),
    remote_document_id TEXT,
    drive_file_id TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

CREATE TABLE sync_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('upload', 'download', 'metadata', 'delete')),
    state TEXT NOT NULL CHECK(state IN ('pending', 'running', 'retry', 'completed', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
    lease_until_ms INTEGER,
    last_error TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);
CREATE INDEX sync_jobs_ready_idx ON sync_jobs(state, next_attempt_at_ms, priority DESC, id ASC);
CREATE UNIQUE INDEX sync_jobs_active_unique
    ON sync_jobs(document_id, operation)
    WHERE state IN ('pending', 'running', 'retry');
PRAGMA user_version = 1;
"#,
        )
        .map_err(|error| format!("Não foi possível criar o catálogo local: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível concluir a migração local: {error}"))?;
    migrate_to_v2(&mut connection)?;
    migrate_to_v3(&mut connection)?;
    migrate_to_v4(&mut connection)?;
    migrate_to_v5(&mut connection)?;
    reset_abandoned_sync_jobs(paths)?;
    Ok(())
}

fn migrate_to_v3(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|error| {
        format!("Não foi possível iniciar a migration de metadados locais: {error}")
    })?;
    for (column, definition) in [
        ("title", "TEXT"),
        ("notebook_id", "TEXT"),
        ("page_count", "INTEGER NOT NULL DEFAULT 1 CHECK(page_count BETWEEN 1 AND 10000)"),
        (
            "status",
            "TEXT CHECK(status IS NULL OR status IN ('uploading', 'pending', 'processing', 'ready', 'partially_ready', 'needs_review', 'failed'))",
        ),
    ] {
        let exists: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name = ?1",
                [column],
                |row| row.get(0),
            )
            .map_err(|error| format!("Não foi possível inspecionar os metadados locais: {error}"))?;
        if exists == 0 {
            transaction
                .execute_batch(&format!("ALTER TABLE documents ADD COLUMN {column} {definition};"))
                .map_err(|error| {
                    format!("Não foi possível ampliar o catálogo local com {column}: {error}")
                })?;
        }
    }
    transaction
        .execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS document_pages (
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL CHECK(page_number >= 1 AND page_number <= 10000),
    native_text TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'ready', 'retryable', 'blocked_quota', 'needs_review', 'failed')),
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(document_id, page_number),
    FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS document_pages_text_idx ON document_pages(document_id, page_number);
"#,
        )
        .map_err(|error| format!("Não foi possível criar o índice de páginas locais: {error}"))?;
    let migration_exists: Option<i64> = transaction
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = 3",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Não foi possível ler o histórico de migrations: {error}"))?;
    if migration_exists.is_none() {
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (3, ?1)",
                [now_ms()],
            )
            .map_err(|error| {
                format!("Não foi possível registrar a migration de metadados: {error}")
            })?;
    }
    transaction
        .execute_batch("PRAGMA user_version = 3;")
        .map_err(|error| {
            format!("Não foi possível atualizar a versão do catálogo local: {error}")
        })?;
    transaction.commit().map_err(|error| {
        format!("Não foi possível concluir a migration de metadados locais: {error}")
    })?;
    Ok(())
}

fn migrate_to_v4(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Não foi possível iniciar a migration de busca local: {error}"))?;
    transaction
        .execute_batch(
            r#"
CREATE VIRTUAL TABLE IF NOT EXISTS document_pages_fts USING fts5(
    document_id UNINDEXED,
    page_number UNINDEXED,
    native_text,
    tokenize = 'unicode61 remove_diacritics 2'
);
DELETE FROM document_pages_fts;
INSERT INTO document_pages_fts (document_id, page_number, native_text)
SELECT document_id, page_number, native_text
FROM document_pages
WHERE native_text IS NOT NULL AND length(native_text) > 0;
"#,
        )
        .map_err(|error| format!("Não foi possível criar o índice de busca local: {error}"))?;
    let migration_exists: Option<i64> = transaction
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = 4",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Não foi possível ler o histórico de migrations: {error}"))?;
    if migration_exists.is_none() {
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (4, ?1)",
                [now_ms()],
            )
            .map_err(|error| format!("Não foi possível registrar a migration de busca: {error}"))?;
    }
    transaction
        .execute_batch("PRAGMA user_version = 4;")
        .map_err(|error| {
            format!("Não foi possível atualizar a versão do catálogo local: {error}")
        })?;
    transaction.commit().map_err(|error| {
        format!("Não foi possível concluir a migration de busca local: {error}")
    })?;
    Ok(())
}

fn migrate_to_v5(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|error| {
        format!("Não foi possível iniciar a migration de análise local: {error}")
    })?;
    for (column, definition) in [
        ("ocr_raw_text", "TEXT"),
        ("corrected_text", "TEXT"),
        (
            "extraction_source",
            "TEXT CHECK(extraction_source IS NULL OR extraction_source IN ('native_pdf', 'ocr', 'manual'))",
        ),
        (
            "ocr_word_geometry_json",
            "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(ocr_word_geometry_json) AND json_type(ocr_word_geometry_json) = 'array')",
        ),
        (
            "warnings_json",
            "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(warnings_json) AND json_type(warnings_json) = 'array')",
        ),
        (
            "was_manually_reviewed",
            "INTEGER NOT NULL DEFAULT 0 CHECK(was_manually_reviewed IN (0, 1))",
        ),
    ] {
        let exists: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('document_pages') WHERE name = ?1",
                [column],
                |row| row.get(0),
            )
            .map_err(|error| format!("Não foi possível inspecionar a análise local: {error}"))?;
        if exists == 0 {
            transaction
                .execute_batch(&format!(
                    "ALTER TABLE document_pages ADD COLUMN {column} {definition};"
                ))
                .map_err(|error| {
                    format!("Não foi possível ampliar a análise local com {column}: {error}")
                })?;
        }
    }
    transaction
        .execute_batch(
            r#"
DELETE FROM document_pages_fts;
INSERT INTO document_pages_fts (document_id, page_number, native_text)
SELECT document_id, page_number,
       COALESCE(NULLIF(corrected_text, ''), NULLIF(native_text, ''), NULLIF(ocr_raw_text, ''))
FROM document_pages
WHERE COALESCE(NULLIF(corrected_text, ''), NULLIF(native_text, ''), NULLIF(ocr_raw_text, '')) IS NOT NULL;
"#,
        )
        .map_err(|error| format!("Não foi possível reconstruir a busca da análise local: {error}"))?;
    let migration_exists: Option<i64> = transaction
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = 5",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Não foi possível ler o histórico de migrations: {error}"))?;
    if migration_exists.is_none() {
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (5, ?1)",
                [now_ms()],
            )
            .map_err(|error| {
                format!("Não foi possível registrar a migration de análise: {error}")
            })?;
    }
    transaction
        .execute_batch("PRAGMA user_version = 5;")
        .map_err(|error| {
            format!("Não foi possível atualizar a versão do catálogo local: {error}")
        })?;
    transaction.commit().map_err(|error| {
        format!("Não foi possível concluir a migration de análise local: {error}")
    })?;
    Ok(())
}

fn migrate_to_v2(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection.transaction().map_err(|error| {
        format!("Não foi possível iniciar a migration do catálogo local: {error}")
    })?;
    transaction
        .execute_batch(
            r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at_ms INTEGER NOT NULL
);
"#,
        )
        .map_err(|error| format!("Não foi possível criar o histórico de migrations: {error}"))?;
    let migration_one_exists: Option<i64> = transaction
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Não foi possível ler o histórico de migrations: {error}"))?;
    if migration_one_exists.is_none() {
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (1, ?1)",
                [now_ms()],
            )
            .map_err(|error| format!("Não foi possível registrar a migration inicial: {error}"))?;
    }

    let payload_column_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sync_jobs') WHERE name = 'payload_json'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Não foi possível inspecionar a fila local: {error}"))?;
    if payload_column_count == 0 {
        transaction
            .execute_batch("ALTER TABLE sync_jobs ADD COLUMN payload_json TEXT;")
            .map_err(|error| format!("Não foi possível atualizar a fila local: {error}"))?;
    }

    let migration_two_exists: Option<i64> = transaction
        .query_row(
            "SELECT version FROM schema_migrations WHERE version = 2",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Não foi possível ler o histórico de migrations: {error}"))?;
    if migration_two_exists.is_none() {
        transaction
            .execute(
                "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (2, ?1)",
                [now_ms()],
            )
            .map_err(|error| format!("Não foi possível registrar a migration da fila: {error}"))?;
    }
    transaction
        .execute_batch("PRAGMA user_version = 2;")
        .map_err(|error| {
            format!("Não foi possível atualizar a versão do catálogo local: {error}")
        })?;
    transaction.commit().map_err(|error| {
        format!("Não foi possível concluir a migration do catálogo local: {error}")
    })?;
    Ok(())
}

fn document_from_row(row: &Row<'_>) -> rusqlite::Result<DocumentRow> {
    Ok(DocumentRow {
        document_id: row.get(0)?,
        owner_id: row.get(1)?,
        original_filename: row.get(2)?,
        mime_type: row.get(3)?,
        size_bytes: row.get(4)?,
        sha256: row.get(5)?,
        relative_path: row.get(6)?,
        local_state: row.get(7)?,
        remote_state: row.get(8)?,
        remote_document_id: row.get(9)?,
        drive_file_id: row.get(10)?,
        created_at_ms: row.get(11)?,
        updated_at_ms: row.get(12)?,
        last_accessed_at_ms: row.get(13)?,
        title: row.get(14)?,
        notebook_id: row.get(15)?,
        page_count: row.get(16)?,
        status: row.get(17)?,
    })
}

fn select_document_sql() -> &'static str {
    "SELECT document_id, owner_id, original_filename, mime_type, size_bytes, sha256, relative_path, local_state, remote_state, remote_document_id, drive_file_id, created_at_ms, updated_at_ms, last_accessed_at_ms, title, notebook_id, page_count, status FROM documents"
}

pub fn get_document(paths: &AppPaths, document_id: &str) -> Result<Option<DocumentRow>, String> {
    let connection = open(paths)?;
    connection
        .query_row(
            &format!("{} WHERE document_id = ?1", select_document_sql()),
            [document_id],
            document_from_row,
        )
        .optional()
        .map_err(|error| format!("Não foi possível consultar o documento local: {error}"))
}

pub fn get_document_by_drive_file_id(
    paths: &AppPaths,
    drive_file_id: &str,
) -> Result<Option<DocumentRow>, String> {
    if drive_file_id.is_empty() || drive_file_id.len() > 512 {
        return Ok(None);
    }
    let connection = open(paths)?;
    connection
        .query_row(
            &format!("{} WHERE drive_file_id = ?1 AND local_state = 'present' ORDER BY updated_at_ms DESC LIMIT 1", select_document_sql()),
            [drive_file_id],
            document_from_row,
        )
        .optional()
        .map_err(|error| format!("Não foi possível consultar o arquivo local do Drive: {error}"))
}

pub fn list_documents(paths: &AppPaths, limit: usize) -> Result<Vec<DocumentRow>, String> {
    let connection = open(paths)?;
    let mut statement = connection
        .prepare(&format!(
            "{} ORDER BY last_accessed_at_ms DESC LIMIT ?1",
            select_document_sql()
        ))
        .map_err(|error| format!("Não foi possível listar a biblioteca local: {error}"))?;
    let rows = statement
        .query_map([limit.min(1000) as i64], document_from_row)
        .map_err(|error| format!("Não foi possível listar a biblioteca local: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler a biblioteca local: {error}"))
}

pub fn list_all_documents(paths: &AppPaths) -> Result<Vec<DocumentRow>, String> {
    let connection = open(paths)?;
    let mut statement = connection
        .prepare(&format!(
            "{} ORDER BY last_accessed_at_ms DESC, document_id ASC",
            select_document_sql()
        ))
        .map_err(|error| format!("Não foi possível listar a biblioteca local: {error}"))?;
    let rows = statement
        .query_map([], document_from_row)
        .map_err(|error| format!("Não foi possível listar a biblioteca local: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler a biblioteca local: {error}"))
}

pub fn list_documents_page(
    paths: &AppPaths,
    limit: usize,
    cursor: Option<&DocumentPageCursor>,
) -> Result<DocumentPage, String> {
    let connection = open(paths)?;
    let page_limit = limit.clamp(1, 1_000);
    let mut statement = connection
        .prepare(&format!(
            "{} WHERE (?1 IS NULL OR last_accessed_at_ms < ?1 OR (last_accessed_at_ms = ?1 AND document_id > ?2)) ORDER BY last_accessed_at_ms DESC, document_id ASC LIMIT ?3",
            select_document_sql()
        ))
        .map_err(|error| format!("Não foi possível preparar a página da biblioteca local: {error}"))?;
    let rows = statement
        .query_map(
            params![
                cursor.map(|value| value.last_accessed_at_ms),
                cursor.map(|value| value.document_id.as_str()),
                (page_limit + 1) as i64
            ],
            document_from_row,
        )
        .map_err(|error| {
            format!("Não foi possível consultar a página da biblioteca local: {error}")
        })?;
    let mut documents = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler a página da biblioteca local: {error}"))?;
    let has_more = documents.len() > page_limit;
    if has_more {
        documents.truncate(page_limit);
    }
    let next_cursor = has_more
        .then(|| documents.last())
        .flatten()
        .map(|document| DocumentPageCursor {
            last_accessed_at_ms: document.last_accessed_at_ms,
            document_id: document.document_id.clone(),
        });
    Ok(DocumentPage {
        documents,
        next_cursor,
    })
}

pub fn touch_document(paths: &AppPaths, document_id: &str) -> Result<(), String> {
    let connection = open(paths)?;
    let now = now_ms();
    connection
        .execute(
            "UPDATE documents SET last_accessed_at_ms = ?2, updated_at_ms = MAX(updated_at_ms, ?2) WHERE document_id = ?1",
            params![document_id, now],
        )
        .map_err(|error| format!("Não foi possível atualizar o acesso local: {error}"))?;
    Ok(())
}

pub fn set_local_state(paths: &AppPaths, document_id: &str, state: &str) -> Result<(), String> {
    if !matches!(state, "present" | "missing" | "corrupt") {
        return Err("Estado local inválido".into());
    }
    let connection = open(paths)?;
    connection
        .execute(
            "UPDATE documents SET local_state = ?2, updated_at_ms = ?3 WHERE document_id = ?1",
            params![document_id, state, now_ms()],
        )
        .map_err(|error| format!("Não foi possível atualizar o estado local: {error}"))?;
    Ok(())
}

pub fn begin_import(paths: &AppPaths, session: &ImportSession) -> Result<(), String> {
    let connection = open(paths)?;
    let now = now_ms();
    connection
        .execute(
            r#"INSERT INTO import_sessions (
                document_id, owner_id, original_filename, mime_type, expected_size, written_bytes,
                staging_relative_path, remote_state, remote_document_id, drive_file_id,
                created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, ?10, ?10)
            ON CONFLICT(document_id) DO UPDATE SET
                owner_id = excluded.owner_id,
                original_filename = excluded.original_filename,
                mime_type = excluded.mime_type,
                expected_size = excluded.expected_size,
                written_bytes = 0,
                staging_relative_path = excluded.staging_relative_path,
                remote_state = excluded.remote_state,
                remote_document_id = excluded.remote_document_id,
                drive_file_id = excluded.drive_file_id,
                updated_at_ms = excluded.updated_at_ms"#,
            params![
                session.document_id,
                session.owner_id,
                session.original_filename,
                session.mime_type,
                session.expected_size,
                session.staging_relative_path,
                session.remote_state,
                session.remote_document_id,
                session.drive_file_id,
                now
            ],
        )
        .map_err(|error| format!("Não foi possível registrar a importação local: {error}"))?;
    Ok(())
}

pub fn get_import(paths: &AppPaths, document_id: &str) -> Result<Option<ImportSession>, String> {
    let connection = open(paths)?;
    connection
        .query_row(
            "SELECT document_id, owner_id, original_filename, mime_type, expected_size, written_bytes, staging_relative_path, remote_state, remote_document_id, drive_file_id FROM import_sessions WHERE document_id = ?1",
            [document_id],
            |row| {
                Ok(ImportSession {
                    document_id: row.get(0)?,
                    owner_id: row.get(1)?,
                    original_filename: row.get(2)?,
                    mime_type: row.get(3)?,
                    expected_size: row.get(4)?,
                    written_bytes: row.get(5)?,
                    staging_relative_path: row.get(6)?,
                    remote_state: row.get(7)?,
                    remote_document_id: row.get(8)?,
                    drive_file_id: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("Não foi possível ler a importação local: {error}"))
}

pub fn update_import_written(
    paths: &AppPaths,
    document_id: &str,
    written_bytes: i64,
) -> Result<(), String> {
    let connection = open(paths)?;
    let changed = connection
        .execute(
            "UPDATE import_sessions SET written_bytes = ?2, updated_at_ms = ?3 WHERE document_id = ?1",
            params![document_id, written_bytes, now_ms()],
        )
        .map_err(|error| format!("Não foi possível atualizar a importação local: {error}"))?;
    if changed != 1 {
        return Err("Importação local não encontrada".into());
    }
    Ok(())
}

pub fn abort_import(paths: &AppPaths, document_id: &str) -> Result<(), String> {
    let connection = open(paths)?;
    connection
        .execute(
            "DELETE FROM import_sessions WHERE document_id = ?1",
            [document_id],
        )
        .map_err(|error| format!("Não foi possível cancelar a importação local: {error}"))?;
    Ok(())
}

fn enqueue_sync_job_tx(
    transaction: &Transaction<'_>,
    document_id: &str,
    operation: &str,
    priority: i64,
    payload_json: Option<&str>,
    now: i64,
) -> Result<(), String> {
    transaction
        .execute(
            r#"INSERT INTO sync_jobs (
                document_id, operation, state, priority, attempts, next_attempt_at_ms,
                lease_until_ms, last_error, payload_json, created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, 'pending', ?3, 0, 0, NULL, NULL, ?4, ?5, ?5)
            ON CONFLICT(document_id, operation) WHERE state IN ('pending', 'running', 'retry')
            DO UPDATE SET
                priority = MAX(priority, excluded.priority),
                payload_json = COALESCE(excluded.payload_json, sync_jobs.payload_json),
                updated_at_ms = excluded.updated_at_ms"#,
            params![document_id, operation, priority, payload_json, now],
        )
        .map_err(|error| format!("Não foi possível enfileirar a sincronização: {error}"))?;
    Ok(())
}

fn upload_payload_json(
    document: &DocumentRow,
    title: Option<&str>,
    notebook_id: Option<&str>,
    prompt_version: i64,
) -> Result<String, String> {
    serde_json::to_string(&serde_json::json!({
        "version": 1,
        "kind": "upload_original",
        "documentId": document.document_id,
        "ownerId": document.owner_id,
        "originalFilename": document.original_filename,
        "title": title.unwrap_or(&document.original_filename),
        "notebookId": notebook_id,
        "promptVersion": prompt_version,
        "mimeType": document.mime_type,
        "sizeBytes": document.size_bytes,
        "sha256": document.sha256,
        "relativePath": document.relative_path,
        "remoteDocumentId": document.remote_document_id,
        "driveFileId": document.drive_file_id
    }))
    .map_err(|error| format!("Não foi possível serializar o payload de sincronização: {error}"))
}

pub fn ensure_upload_job(
    paths: &AppPaths,
    document_id: &str,
    title: Option<&str>,
    notebook_id: Option<&str>,
    prompt_version: i64,
) -> Result<bool, String> {
    let mut connection = open(paths)?;
    let transaction = connection.transaction().map_err(|error| {
        format!("Não foi possível iniciar a recuperação da sincronização: {error}")
    })?;
    let document = transaction
        .query_row(
            &format!("{} WHERE document_id = ?1", select_document_sql()),
            [document_id],
            document_from_row,
        )
        .optional()
        .map_err(|error| {
            format!("Não foi possível consultar o documento da sincronização: {error}")
        })?;
    let Some(document) = document else {
        transaction.commit().map_err(|error| {
            format!("Não foi possível concluir a recuperação da sincronização: {error}")
        })?;
        return Ok(false);
    };
    if document.remote_state != "pending" {
        transaction.commit().map_err(|error| {
            format!("Não foi possível concluir a recuperação da sincronização: {error}")
        })?;
        return Ok(false);
    }
    let existing_payload: Option<Option<String>> = transaction
        .query_row(
            "SELECT payload_json FROM sync_jobs WHERE document_id = ?1 AND operation = 'upload' AND state IN ('pending', 'running', 'retry') LIMIT 1",
            [document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| {
            format!("Não foi possível consultar o payload da sincronização: {error}")
        })?;
    let payload = if title.is_none() && notebook_id.is_none() && prompt_version == 1 {
        existing_payload.flatten().unwrap_or(upload_payload_json(
            &document,
            None,
            None,
            prompt_version,
        )?)
    } else {
        upload_payload_json(&document, title, notebook_id, prompt_version)?
    };
    enqueue_sync_job_tx(
        &transaction,
        document_id,
        "upload",
        50,
        Some(&payload),
        now_ms(),
    )?;
    transaction.commit().map_err(|error| {
        format!("Não foi possível confirmar a recuperação da sincronização: {error}")
    })?;
    Ok(true)
}

pub fn commit_import(paths: &AppPaths, document: &DocumentRow) -> Result<(), String> {
    let mut connection = open(paths)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Não foi possível iniciar a confirmação local: {error}"))?;
    transaction
        .execute(
            r#"INSERT INTO documents (
                document_id, owner_id, original_filename, mime_type, size_bytes, sha256,
                relative_path, local_state, remote_state, remote_document_id, drive_file_id,
                created_at_ms, updated_at_ms, last_accessed_at_ms, title, notebook_id, page_count, status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
            ON CONFLICT(document_id) DO UPDATE SET
                owner_id = excluded.owner_id,
                original_filename = excluded.original_filename,
                mime_type = excluded.mime_type,
                size_bytes = excluded.size_bytes,
                sha256 = excluded.sha256,
                relative_path = excluded.relative_path,
                local_state = excluded.local_state,
                remote_state = excluded.remote_state,
                remote_document_id = COALESCE(excluded.remote_document_id, documents.remote_document_id),
                drive_file_id = COALESCE(excluded.drive_file_id, documents.drive_file_id),
                updated_at_ms = excluded.updated_at_ms,
                last_accessed_at_ms = excluded.last_accessed_at_ms"#,
            params![
                document.document_id,
                document.owner_id,
                document.original_filename,
                document.mime_type,
                document.size_bytes,
                document.sha256,
                document.relative_path,
                document.local_state,
                document.remote_state,
                document.remote_document_id,
                document.drive_file_id,
                document.created_at_ms,
                document.updated_at_ms,
                document.last_accessed_at_ms,
                document.title,
                document.notebook_id,
                document.page_count,
                document.status,
            ],
        )
        .map_err(|error| format!("Não foi possível salvar o documento local: {error}"))?;
    transaction
        .execute(
            "DELETE FROM import_sessions WHERE document_id = ?1",
            [&document.document_id],
        )
        .map_err(|error| format!("Não foi possível concluir a importação local: {error}"))?;
    if document.remote_state == "pending" {
        let payload = upload_payload_json(document, None, None, 1)?;
        enqueue_sync_job_tx(
            &transaction,
            &document.document_id,
            "upload",
            50,
            Some(&payload),
            now_ms(),
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível confirmar o documento local: {error}"))?;
    Ok(())
}

fn document_page_metadata_from_row(row: &Row<'_>) -> rusqlite::Result<DocumentPageMetadataRow> {
    Ok(DocumentPageMetadataRow {
        document_id: row.get(0)?,
        page_number: row.get(1)?,
        native_text: row.get(2)?,
        ocr_raw_text: row.get(3)?,
        corrected_text: row.get(4)?,
        extraction_source: row.get(5)?,
        ocr_word_geometry_json: row.get(6)?,
        warnings_json: row.get(7)?,
        was_manually_reviewed: row.get::<_, i64>(8)? != 0,
        status: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn validate_page_json(value: &str, label: &str) -> Result<(), String> {
    let parsed: Value =
        serde_json::from_str(value).map_err(|_| format!("JSON de {label} local inválido"))?;
    let entries = parsed
        .as_array()
        .ok_or_else(|| format!("JSON de {label} local deve ser uma lista"))?;
    let maximum = if label == "geometria" { 20_000 } else { 100 };
    if entries.len() > maximum {
        return Err(format!("Quantidade de {label} local excede o limite"));
    }
    for entry in entries {
        if label == "geometria" {
            let object = entry
                .as_object()
                .ok_or_else(|| "Geometria local inválida".to_string())?;
            let _text = object
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty() && text.len() <= 256 && *text == text.trim())
                .ok_or_else(|| "Texto da geometria local inválido".to_string())?;
            let coordinates = ["left", "top", "right", "bottom"]
                .iter()
                .map(|key| object.get(*key).and_then(Value::as_i64))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| "Coordenada da geometria local inválida".to_string())?;
            if coordinates
                .iter()
                .any(|value| !(0..=10_000).contains(value))
                || coordinates[2] <= coordinates[0]
                || coordinates[3] <= coordinates[1]
            {
                return Err("Coordenada da geometria local inválida".into());
            }
        } else {
            let object = entry
                .as_object()
                .ok_or_else(|| "Aviso local inválido".to_string())?;
            let code = object
                .get("code")
                .and_then(Value::as_str)
                .filter(|code| {
                    (2..=64).contains(&code.len())
                        && code
                            .chars()
                            .next()
                            .is_some_and(|value| value.is_ascii_lowercase())
                        && code.chars().all(|value| {
                            value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_'
                        })
                })
                .ok_or_else(|| "Código do aviso local inválido".to_string())?;
            let message = object
                .get("message")
                .and_then(Value::as_str)
                .filter(|message| !message.trim().is_empty() && message.len() <= 300)
                .ok_or_else(|| "Mensagem do aviso local inválida".to_string())?;
            let _ = (code, message);
        }
    }
    Ok(())
}

pub fn update_document_metadata(
    paths: &AppPaths,
    document_id: &str,
    metadata: DocumentMetadataInput,
) -> Result<(), String> {
    if metadata.title.trim().is_empty() || metadata.title.len() > 240 {
        return Err("Título local inválido".into());
    }
    if !(1..=10_000).contains(&metadata.page_count)
        || metadata.pages.len() != metadata.page_count as usize
    {
        return Err("Quantidade de páginas local inválida".into());
    }
    if !matches!(
        metadata.status.as_str(),
        "processing" | "partially_ready" | "ready" | "needs_review" | "failed"
    ) {
        return Err("Status local inválido".into());
    }
    let mut connection = open(paths)?;
    let transaction = connection.transaction().map_err(|error| {
        format!("Não foi possível iniciar a atualização de metadados locais: {error}")
    })?;
    let now = now_ms();
    let changed = transaction
        .execute(
            "UPDATE documents SET title = ?3, notebook_id = ?4, page_count = ?5, status = ?6, updated_at_ms = MAX(updated_at_ms, ?7) WHERE document_id = ?1 AND owner_id = ?2",
            params![
                document_id,
                metadata.owner_id,
                metadata.title.trim(),
                metadata.notebook_id,
                metadata.page_count,
                metadata.status,
                now
            ],
        )
        .map_err(|error| format!("Não foi possível salvar os metadados do documento: {error}"))?;
    if changed != 1 {
        return Err("Documento local não encontrado para este proprietário".into());
    }
    transaction
        .execute(
            "DELETE FROM document_pages WHERE document_id = ?1",
            [document_id],
        )
        .map_err(|error| format!("Não foi possível substituir as páginas locais: {error}"))?;
    let mut seen_pages = std::collections::HashSet::new();
    for page in &metadata.pages {
        if !(1..=metadata.page_count).contains(&page.page_number)
            || !seen_pages.insert(page.page_number)
        {
            return Err("Página local fora do documento".into());
        }
        if page
            .native_text
            .as_ref()
            .is_some_and(|text| text.len() > 1_000_000)
        {
            return Err("Texto nativo local excede o limite".into());
        }
        if page
            .ocr_raw_text
            .as_ref()
            .is_some_and(|text| text.len() > 1_000_000)
            || page
                .corrected_text
                .as_ref()
                .is_some_and(|text| text.len() > 1_000_000)
        {
            return Err("Texto de análise local excede o limite".into());
        }
        if !matches!(
            page.extraction_source.as_deref(),
            None | Some("native_pdf") | Some("ocr") | Some("manual")
        ) {
            return Err("Origem de extração local inválida".into());
        }
        validate_page_json(&page.ocr_word_geometry_json, "geometria")?;
        validate_page_json(&page.warnings_json, "avisos")?;
        transaction
            .execute(
                r#"INSERT INTO document_pages (
                    document_id, page_number, native_text, ocr_raw_text, corrected_text,
                    extraction_source, ocr_word_geometry_json, warnings_json,
                    was_manually_reviewed, status, updated_at_ms
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                    CASE WHEN COALESCE(?5, ?4, ?3) IS NULL AND ?10 = 'ready' THEN 'needs_review'
                         WHEN COALESCE(?5, ?4, ?3) IS NULL THEN 'processing'
                         ELSE 'ready' END, ?11)"#,
                params![
                    document_id,
                    page.page_number,
                    page.native_text,
                    page.ocr_raw_text,
                    page.corrected_text,
                    page.extraction_source,
                    page.ocr_word_geometry_json,
                    page.warnings_json,
                    page.was_manually_reviewed as i64,
                    metadata.status,
                    now
                ],
            )
            .map_err(|error| {
                format!("Não foi possível salvar os metadados da página local: {error}")
            })?;
    }
    transaction
        .execute(
            "DELETE FROM document_pages_fts WHERE document_id = ?1",
            [document_id],
        )
        .map_err(|error| format!("Não foi possível atualizar a busca local: {error}"))?;
    transaction
        .execute(
            "INSERT INTO document_pages_fts (document_id, page_number, native_text) SELECT document_id, page_number, COALESCE(NULLIF(corrected_text, ''), NULLIF(native_text, ''), NULLIF(ocr_raw_text, '')) FROM document_pages WHERE document_id = ?1 AND COALESCE(NULLIF(corrected_text, ''), NULLIF(native_text, ''), NULLIF(ocr_raw_text, '')) IS NOT NULL",
            [document_id],
        )
        .map_err(|error| format!("Não foi possível indexar o texto local: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível confirmar os metadados locais: {error}"))?;
    Ok(())
}

pub fn update_document_page_metadata(
    paths: &AppPaths,
    document_id: &str,
    owner_id: &str,
    status: &str,
    page: DocumentPageMetadataInput,
) -> Result<(), String> {
    if !matches!(
        status,
        "pending"
            | "processing"
            | "ready"
            | "retryable"
            | "blocked_quota"
            | "needs_review"
            | "failed"
    ) {
        return Err("Status da página local inválido".into());
    }
    if page
        .native_text
        .as_ref()
        .is_some_and(|text| text.len() > 1_000_000)
        || page
            .ocr_raw_text
            .as_ref()
            .is_some_and(|text| text.len() > 1_000_000)
        || page
            .corrected_text
            .as_ref()
            .is_some_and(|text| text.len() > 1_000_000)
    {
        return Err("Texto de análise local excede o limite".into());
    }
    if !matches!(
        page.extraction_source.as_deref(),
        None | Some("native_pdf") | Some("ocr") | Some("manual")
    ) {
        return Err("Origem de extração local inválida".into());
    }
    validate_page_json(&page.ocr_word_geometry_json, "geometria")?;
    validate_page_json(&page.warnings_json, "avisos")?;

    let mut connection = open(paths)?;
    let transaction = connection.transaction().map_err(|error| {
        format!("Não foi possível iniciar a atualização da página local: {error}")
    })?;
    let page_count: i64 = transaction
        .query_row(
            "SELECT page_count FROM documents WHERE document_id = ?1 AND owner_id = ?2",
            params![document_id, owner_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Não foi possível consultar a página local: {error}"))?
        .ok_or_else(|| "Documento local não encontrado para este proprietário".to_string())?;
    if !(1..=page_count).contains(&page.page_number) {
        return Err("Página local fora do documento".into());
    }
    let now = now_ms();
    transaction
        .execute(
            r#"INSERT INTO document_pages (
                document_id, page_number, native_text, ocr_raw_text, corrected_text,
                extraction_source, ocr_word_geometry_json, warnings_json,
                was_manually_reviewed, status, updated_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(document_id, page_number) DO UPDATE SET
                native_text = excluded.native_text,
                ocr_raw_text = excluded.ocr_raw_text,
                corrected_text = excluded.corrected_text,
                extraction_source = excluded.extraction_source,
                ocr_word_geometry_json = excluded.ocr_word_geometry_json,
                warnings_json = excluded.warnings_json,
                was_manually_reviewed = excluded.was_manually_reviewed,
                status = excluded.status,
                updated_at_ms = MAX(document_pages.updated_at_ms, excluded.updated_at_ms)"#,
            params![
                document_id,
                page.page_number,
                page.native_text,
                page.ocr_raw_text,
                page.corrected_text,
                page.extraction_source,
                page.ocr_word_geometry_json,
                page.warnings_json,
                page.was_manually_reviewed as i64,
                status,
                now
            ],
        )
        .map_err(|error| format!("Não foi possível salvar a página local: {error}"))?;
    transaction
        .execute(
            "DELETE FROM document_pages_fts WHERE document_id = ?1",
            [document_id],
        )
        .map_err(|error| format!("Não foi possível atualizar a busca local: {error}"))?;
    transaction
        .execute(
            "INSERT INTO document_pages_fts (document_id, page_number, native_text) SELECT document_id, page_number, COALESCE(NULLIF(corrected_text, ''), NULLIF(native_text, ''), NULLIF(ocr_raw_text, '')) FROM document_pages WHERE document_id = ?1 AND COALESCE(NULLIF(corrected_text, ''), NULLIF(native_text, ''), NULLIF(ocr_raw_text, '')) IS NOT NULL",
            [document_id],
        )
        .map_err(|error| format!("Não foi possível indexar a página local: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível confirmar a página local: {error}"))?;
    Ok(())
}

pub fn list_document_pages(
    paths: &AppPaths,
    document_id: &str,
    owner_id: &str,
) -> Result<Vec<DocumentPageMetadataRow>, String> {
    let connection = open(paths)?;
    let mut statement = connection
        .prepare(
            "SELECT p.document_id, p.page_number, p.native_text, p.ocr_raw_text, p.corrected_text, p.extraction_source, p.ocr_word_geometry_json, p.warnings_json, p.was_manually_reviewed, p.status, p.updated_at_ms FROM document_pages p INNER JOIN documents d ON d.document_id = p.document_id WHERE p.document_id = ?1 AND d.owner_id = ?2 ORDER BY p.page_number ASC",
        )
        .map_err(|error| format!("Não foi possível preparar as páginas locais: {error}"))?;
    let rows = statement
        .query_map(
            params![document_id, owner_id],
            document_page_metadata_from_row,
        )
        .map_err(|error| format!("Não foi possível consultar as páginas locais: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler as páginas locais: {error}"))
}

fn safe_fts_query(query: &str) -> Result<String, String> {
    let terms = query
        .split_whitespace()
        .filter_map(|term| {
            let normalized: String = term
                .chars()
                .filter(|value| value.is_alphanumeric())
                .collect();
            (!normalized.is_empty()).then(|| format!("\"{normalized}\"*"))
        })
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Err("Consulta local vazia".into());
    }
    Ok(terms.join(" AND "))
}

pub fn search_document_pages(
    paths: &AppPaths,
    owner_id: &str,
    query: &str,
    limit: usize,
    offset: usize,
    notebook_id: Option<&str>,
) -> Result<Vec<DocumentSearchPageRow>, String> {
    if query.trim().is_empty() || query.len() > 200 {
        return Err("Consulta local inválida".into());
    }
    let fts_query = safe_fts_query(query)?;
    let connection = open(paths)?;
    let mut statement = connection
        .prepare(
            "SELECT f.document_id, d.title, d.notebook_id, f.page_number, f.native_text, bm25(document_pages_fts) FROM document_pages_fts AS f INNER JOIN documents AS d ON d.document_id = f.document_id WHERE document_pages_fts MATCH ?1 AND d.owner_id = ?2 AND (?3 IS NULL OR d.notebook_id = ?3) ORDER BY bm25(document_pages_fts) ASC, f.document_id ASC, f.page_number ASC LIMIT ?4 OFFSET ?5",
        )
        .map_err(|error| format!("Não foi possível preparar a busca local: {error}"))?;
    let rows = statement
        .query_map(
            params![
                fts_query,
                owner_id,
                notebook_id,
                limit.clamp(1, 100) as i64,
                offset.min(10_000) as i64
            ],
            |row| {
                let score: f64 = row.get(5)?;
                Ok(DocumentSearchPageRow {
                    document_id: row.get(0)?,
                    document_title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    notebook_id: row.get(2)?,
                    page_number: row.get(3)?,
                    native_text: row.get(4)?,
                    rank: -score,
                })
            },
        )
        .map_err(|error| format!("Não foi possível consultar a busca local: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler os resultados locais: {error}"))
}

fn sync_job_from_row(row: &Row<'_>) -> rusqlite::Result<SyncJob> {
    Ok(SyncJob {
        id: row.get(0)?,
        document_id: row.get(1)?,
        operation: row.get(2)?,
        state: row.get(3)?,
        priority: row.get(4)?,
        attempts: row.get(5)?,
        next_attempt_at_ms: row.get(6)?,
        lease_until_ms: row.get(7)?,
        last_error: row.get(8)?,
        payload_json: row.get(9)?,
        created_at_ms: row.get(10)?,
        updated_at_ms: row.get(11)?,
    })
}

fn select_sync_job_sql() -> &'static str {
    "SELECT id, document_id, operation, state, priority, attempts, next_attempt_at_ms, lease_until_ms, last_error, payload_json, created_at_ms, updated_at_ms FROM sync_jobs"
}

pub fn list_sync_jobs(paths: &AppPaths, limit: usize) -> Result<Vec<SyncJob>, String> {
    let connection = open(paths)?;
    let mut statement = connection
        .prepare(&format!(
            "{} WHERE state != 'completed' AND state != 'cancelled' ORDER BY priority DESC, id ASC LIMIT ?1",
            select_sync_job_sql()
        ))
        .map_err(|error| format!("Não foi possível listar a fila de sincronização: {error}"))?;
    let rows = statement
        .query_map([limit.clamp(1, 100) as i64], sync_job_from_row)
        .map_err(|error| format!("Não foi possível listar a fila de sincronização: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler a fila de sincronização: {error}"))
}

pub fn claim_sync_jobs(
    paths: &AppPaths,
    limit: usize,
    lease_ms: i64,
) -> Result<Vec<SyncJob>, String> {
    let mut connection = open(paths)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Não foi possível bloquear a fila de sincronização: {error}"))?;
    let now = now_ms();
    let lease_until = now.saturating_add(lease_ms.clamp(5_000, 10 * 60_000));
    let ids = {
        let mut statement = transaction
            .prepare(
                "SELECT id FROM sync_jobs WHERE state IN ('pending', 'retry') AND next_attempt_at_ms <= ?1 AND (lease_until_ms IS NULL OR lease_until_ms <= ?1) ORDER BY priority DESC, id ASC LIMIT ?2",
            )
            .map_err(|error| format!("Não foi possível consultar a fila de sincronização: {error}"))?;
        let rows = statement
            .query_map(params![now, limit.clamp(1, 20) as i64], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|error| {
                format!("Não foi possível consultar a fila de sincronização: {error}")
            })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Não foi possível ler a fila de sincronização: {error}"))?
    };

    let mut jobs = Vec::with_capacity(ids.len());
    for id in ids {
        transaction
            .execute(
                "UPDATE sync_jobs SET state = 'running', attempts = attempts + 1, lease_until_ms = ?2, updated_at_ms = ?3 WHERE id = ?1",
                params![id, lease_until, now],
            )
            .map_err(|error| format!("Não foi possível reservar a sincronização: {error}"))?;
        let job = transaction
            .query_row(
                &format!("{} WHERE id = ?1", select_sync_job_sql()),
                [id],
                sync_job_from_row,
            )
            .map_err(|error| format!("Não foi possível ler a sincronização reservada: {error}"))?;
        jobs.push(job);
    }
    transaction.commit().map_err(|error| {
        format!("Não foi possível confirmar a reserva de sincronização: {error}")
    })?;
    Ok(jobs)
}

pub fn complete_sync_job(paths: &AppPaths, id: i64) -> Result<(), String> {
    let connection = open(paths)?;
    connection
        .execute(
            "UPDATE sync_jobs SET state = 'completed', lease_until_ms = NULL, last_error = NULL, updated_at_ms = ?2 WHERE id = ?1 AND state = 'running'",
            params![id, now_ms()],
        )
        .map_err(|error| format!("Não foi possível concluir a sincronização: {error}"))?;
    Ok(())
}

pub fn fail_sync_job(
    paths: &AppPaths,
    id: i64,
    error: &str,
    retry_after_ms: i64,
) -> Result<(), String> {
    let connection = open(paths)?;
    let now = now_ms();
    let next = now.saturating_add(retry_after_ms.clamp(1_000, 24 * 60 * 60_000));
    let message: String = error.chars().take(2_000).collect();
    connection
        .execute(
            "UPDATE sync_jobs SET state = 'retry', lease_until_ms = NULL, last_error = ?2, next_attempt_at_ms = ?3, updated_at_ms = ?4 WHERE id = ?1 AND state = 'running'",
            params![id, message, next, now],
        )
        .map_err(|db_error| format!("Não foi possível reagendar a sincronização: {db_error}"))?;
    Ok(())
}

pub fn cancel_sync_job(paths: &AppPaths, id: i64, error: &str) -> Result<(), String> {
    let connection = open(paths)?;
    let now = now_ms();
    let message: String = error.chars().take(2_000).collect();
    connection
        .execute(
            "UPDATE sync_jobs SET state = 'cancelled', lease_until_ms = NULL, last_error = ?2, updated_at_ms = ?3 WHERE id = ?1 AND state = 'running'",
            params![id, message, now],
        )
        .map_err(|db_error| format!("Não foi possível cancelar a sincronização: {db_error}"))?;
    Ok(())
}

pub fn reset_abandoned_sync_jobs(paths: &AppPaths) -> Result<(), String> {
    let connection = open(paths)?;
    let now = now_ms();
    connection
        .execute(
            "UPDATE sync_jobs SET state = 'retry', lease_until_ms = NULL, next_attempt_at_ms = ?1, updated_at_ms = ?1 WHERE state = 'running' AND (lease_until_ms IS NULL OR lease_until_ms <= ?1)",
            [now],
        )
        .map_err(|error| format!("Não foi possível recuperar a fila interrompida: {error}"))?;
    Ok(())
}

pub fn mark_remote_synced(
    paths: &AppPaths,
    document_id: &str,
    remote_document_id: Option<&str>,
    drive_file_id: Option<&str>,
) -> Result<(), String> {
    let mut connection = open(paths)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Não foi possível iniciar a confirmação remota: {error}"))?;
    let now = now_ms();
    transaction
        .execute(
            "UPDATE documents SET remote_state = 'synced', remote_document_id = COALESCE(?2, remote_document_id), drive_file_id = COALESCE(?3, drive_file_id), updated_at_ms = ?4 WHERE document_id = ?1",
            params![document_id, remote_document_id, drive_file_id, now],
        )
        .map_err(|error| format!("Não foi possível atualizar o estado remoto: {error}"))?;
    transaction
        .execute(
            "UPDATE sync_jobs SET state = 'completed', lease_until_ms = NULL, last_error = NULL, updated_at_ms = ?2 WHERE document_id = ?1 AND operation = 'upload' AND state IN ('pending', 'running', 'retry')",
            params![document_id, now],
        )
        .map_err(|error| format!("Não foi possível concluir a fila remota: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível confirmar o estado remoto: {error}"))?;
    Ok(())
}
