use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    time::Duration,
};

use crate::{
    catalog::{self, DocumentRow, ImportSession},
    paths::{self, AppPaths},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecoverySummary {
    pub recovered_documents: usize,
    pub discarded_partial_imports: usize,
    pub removed_orphan_staging_files: usize,
}

fn import_ids(paths: &AppPaths) -> Result<Vec<String>, String> {
    let connection = Connection::open(&paths.database)
        .map_err(|error| format!("Não foi possível abrir a recuperação local: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Não foi possível configurar a recuperação local: {error}"))?;
    let mut statement = connection
        .prepare("SELECT document_id FROM import_sessions ORDER BY created_at_ms ASC")
        .map_err(|error| format!("Não foi possível preparar a recuperação local: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| {
            format!("Não foi possível consultar importações interrompidas: {error}")
        })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler importações interrompidas: {error}"))
}

fn hash_file(path: &std::path::Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Não foi possível verificar um original recuperável: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            format!("Não foi possível verificar um original recuperável: {error}")
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    buffer.fill(0);
    Ok(format!("{:x}", hasher.finalize()))
}

fn valid_hash_stem(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn recover_moved_document(
    paths: &AppPaths,
    session: &ImportSession,
) -> Result<Option<DocumentRow>, String> {
    paths::validate_document_id(&session.document_id)?;
    let directory = paths.documents.join(&session.document_id);
    if !directory.is_dir() {
        return Ok(None);
    }

    let expected_size = u64::try_from(session.expected_size)
        .map_err(|_| "Tamanho inválido em importação interrompida")?;
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| format!("Não foi possível verificar originais recuperáveis: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Não foi possível ler originais recuperáveis: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let file_type = entry.file_type().map_err(|error| {
            format!("Não foi possível verificar um original recuperável: {error}")
        })?;
        if !file_type.is_file() {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| {
            format!("Não foi possível verificar um original recuperável: {error}")
        })?;
        if metadata.len() != expected_size {
            continue;
        }
        let path = entry.path();
        let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if !valid_hash_stem(stem) {
            continue;
        }
        let actual_hash = hash_file(&path)?;
        if actual_hash != stem {
            continue;
        }
        let Some(filename) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let relative_path = format!("documents/{}/{}", session.document_id, filename);
        let now = catalog::now_ms();
        return Ok(Some(DocumentRow {
            document_id: session.document_id.clone(),
            owner_id: session.owner_id.clone(),
            original_filename: session.original_filename.clone(),
            mime_type: session.mime_type.clone(),
            size_bytes: session.expected_size,
            sha256: actual_hash,
            relative_path,
            local_state: "present".into(),
            remote_state: session.remote_state.clone(),
            remote_document_id: session.remote_document_id.clone(),
            drive_file_id: session.drive_file_id.clone(),
            created_at_ms: now,
            updated_at_ms: now,
            last_accessed_at_ms: now,
        }));
    }
    Ok(None)
}

pub fn recover_abandoned_imports(paths: &AppPaths) -> Result<RecoverySummary, String> {
    let mut summary = RecoverySummary::default();

    for document_id in import_ids(paths)? {
        paths::validate_document_id(&document_id)?;
        let Some(session) = catalog::get_import(paths, &document_id)? else {
            continue;
        };
        let staging_path = paths::resolve_relative(&paths.root, &session.staging_relative_path)?;

        if catalog::get_document(paths, &document_id)?.is_some() {
            if staging_path.is_file() {
                fs::remove_file(&staging_path).map_err(|error| {
                    format!("Não foi possível limpar staging já confirmado: {error}")
                })?;
            }
            catalog::abort_import(paths, &document_id)?;
            continue;
        }

        if staging_path.is_file() {
            fs::remove_file(&staging_path)
                .map_err(|error| format!("Não foi possível limpar importação parcial: {error}"))?;
            catalog::abort_import(paths, &document_id)?;
            summary.discarded_partial_imports += 1;
            continue;
        }

        if let Some(document) = recover_moved_document(paths, &session)? {
            catalog::commit_import(paths, &document)?;
            summary.recovered_documents += 1;
        } else {
            catalog::abort_import(paths, &document_id)?;
        }
    }

    for entry in fs::read_dir(&paths.staging)
        .map_err(|error| format!("Não foi possível verificar o staging local: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Não foi possível ler o staging local: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("Não foi possível verificar o staging local: {error}"))?
            .is_file()
        {
            fs::remove_file(entry.path())
                .map_err(|error| format!("Não foi possível limpar staging órfão: {error}"))?;
            summary.removed_orphan_staging_files += 1;
        }
    }

    Ok(summary)
}
