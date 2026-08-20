use rusqlite::Connection;
use std::{fs, time::Duration};

use crate::paths::AppPaths;

#[derive(Clone, Debug)]
pub struct StorageMetrics {
    pub present_document_count: usize,
    pub present_document_bytes: u64,
    pub protected_document_count: usize,
    pub pending_sync_count: usize,
    pub staging_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct EvictableDocument {
    pub document_id: String,
    pub relative_path: String,
    pub size_bytes: u64,
}

fn open(paths: &AppPaths) -> Result<Connection, String> {
    let connection = Connection::open(&paths.database)
        .map_err(|error| format!("Não foi possível abrir as métricas locais: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Não foi possível configurar as métricas locais: {error}"))?;
    Ok(connection)
}

fn non_negative_u64(value: i64, label: &str) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| format!("{label} local inválido"))
}

fn non_negative_usize(value: i64, label: &str) -> Result<usize, String> {
    usize::try_from(value).map_err(|_| format!("{label} local inválido"))
}

pub fn read(paths: &AppPaths) -> Result<StorageMetrics, String> {
    let connection = open(paths)?;
    let (present_count, present_bytes, protected_count): (i64, i64, i64) = connection
        .query_row(
            r#"SELECT
                COUNT(*) FILTER (WHERE local_state = 'present'),
                COALESCE(SUM(size_bytes) FILTER (WHERE local_state = 'present'), 0),
                COUNT(*) FILTER (WHERE local_state = 'present' AND remote_state != 'synced')
            FROM documents"#,
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Não foi possível calcular o uso dos documentos locais: {error}"))?;
    let pending_sync_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sync_jobs WHERE state NOT IN ('completed', 'cancelled')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Não foi possível calcular a fila local: {error}"))?;

    let staging_bytes = fs::read_dir(&paths.staging)
        .map_err(|error| format!("Não foi possível calcular o staging local: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .fold(0_u64, u64::saturating_add);

    Ok(StorageMetrics {
        present_document_count: non_negative_usize(present_count, "Contagem de documentos")?,
        present_document_bytes: non_negative_u64(present_bytes, "Uso de documentos")?,
        protected_document_count: non_negative_usize(protected_count, "Contagem protegida")?,
        pending_sync_count: non_negative_usize(pending_sync_count, "Contagem de sincronização")?,
        staging_bytes,
    })
}

pub fn disk_usage_bytes(paths: &AppPaths) -> Result<u64, String> {
    let metrics = read(paths)?;
    Ok(metrics
        .present_document_bytes
        .saturating_add(metrics.staging_bytes))
}

pub fn list_oldest_evictable(
    paths: &AppPaths,
    limit: usize,
) -> Result<Vec<EvictableDocument>, String> {
    let connection = open(paths)?;
    let mut statement = connection
        .prepare(
            r#"SELECT document_id, relative_path, size_bytes
            FROM documents
            WHERE local_state = 'present' AND remote_state = 'synced'
            ORDER BY last_accessed_at_ms ASC, document_id ASC
            LIMIT ?1"#,
        )
        .map_err(|error| format!("Não foi possível preparar a limpeza local: {error}"))?;
    let rows = statement
        .query_map([limit.clamp(1, 256) as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| format!("Não foi possível consultar documentos liberáveis: {error}"))?;

    rows.map(|row| {
        let (document_id, relative_path, size_bytes) =
            row.map_err(|error| format!("Não foi possível ler a limpeza local: {error}"))?;
        Ok(EvictableDocument {
            document_id,
            relative_path,
            size_bytes: non_negative_u64(size_bytes, "Tamanho de documento")?,
        })
    })
    .collect()
}
