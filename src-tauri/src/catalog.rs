use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::Serialize;
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
    if version > 1 {
        return Err(format!(
            "Catálogo local criado por uma versão mais nova do Fichário (schema {version})"
        ));
    }
    if version == 1 {
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
    })
}

fn select_document_sql() -> &'static str {
    "SELECT document_id, owner_id, original_filename, mime_type, size_bytes, sha256, relative_path, local_state, remote_state, remote_document_id, drive_file_id, created_at_ms, updated_at_ms, last_accessed_at_ms FROM documents"
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

pub fn get_document_by_drive_file_id(paths: &AppPaths, drive_file_id: &str) -> Result<Option<DocumentRow>, String> {
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

pub fn update_import_written(paths: &AppPaths, document_id: &str, written_bytes: i64) -> Result<(), String> {
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
        .execute("DELETE FROM import_sessions WHERE document_id = ?1", [document_id])
        .map_err(|error| format!("Não foi possível cancelar a importação local: {error}"))?;
    Ok(())
}

fn enqueue_sync_job_tx(
    transaction: &Transaction<'_>,
    document_id: &str,
    operation: &str,
    priority: i64,
    now: i64,
) -> Result<(), String> {
    transaction
        .execute(
            r#"INSERT INTO sync_jobs (
                document_id, operation, state, priority, attempts, next_attempt_at_ms,
                lease_until_ms, last_error, created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, 'pending', ?3, 0, ?4, NULL, NULL, ?4, ?4)
            ON CONFLICT(document_id, operation) WHERE state IN ('pending', 'running', 'retry')
            DO UPDATE SET priority = MAX(priority, excluded.priority), updated_at_ms = excluded.updated_at_ms"#,
            params![document_id, operation, priority, now],
        )
        .map_err(|error| format!("Não foi possível enfileirar a sincronização: {error}"))?;
    Ok(())
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
                created_at_ms, updated_at_ms, last_accessed_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
        enqueue_sync_job_tx(&transaction, &document.document_id, "upload", 50, now_ms())?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível confirmar o documento local: {error}"))?;
    Ok(())
}

pub fn clear_import_sessions(paths: &AppPaths) -> Result<(), String> {
    let connection = open(paths)?;
    connection
        .execute("DELETE FROM import_sessions", [])
        .map_err(|error| format!("Não foi possível limpar importações interrompidas: {error}"))?;
    Ok(())
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
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn select_sync_job_sql() -> &'static str {
    "SELECT id, document_id, operation, state, priority, attempts, next_attempt_at_ms, lease_until_ms, last_error, created_at_ms, updated_at_ms FROM sync_jobs"
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

pub fn claim_sync_jobs(paths: &AppPaths, limit: usize, lease_ms: i64) -> Result<Vec<SyncJob>, String> {
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
            .query_map(params![now, limit.clamp(1, 20) as i64], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("Não foi possível consultar a fila de sincronização: {error}"))?;
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
    transaction
        .commit()
        .map_err(|error| format!("Não foi possível confirmar a reserva de sincronização: {error}"))?;
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

pub fn fail_sync_job(paths: &AppPaths, id: i64, error: &str, retry_after_ms: i64) -> Result<(), String> {
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
