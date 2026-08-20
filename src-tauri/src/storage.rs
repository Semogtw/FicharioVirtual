use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
};

use crate::{
    catalog::{self, DocumentRow, ImportSession},
    paths::{self, AppPaths, MAX_NATIVE_DOCUMENT_BYTES},
};

pub const MAX_IPC_CHUNK_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginImportRequest {
    pub document_id: String,
    pub owner_id: String,
    pub original_filename: String,
    pub mime_type: String,
    pub expected_size: u64,
    pub remote_state: Option<String>,
    pub remote_document_id: Option<String>,
    pub drive_file_id: Option<String>,
}

fn validate_begin(request: &BeginImportRequest) -> Result<String, String> {
    paths::validate_document_id(&request.document_id)?;
    if request.owner_id.trim().is_empty() || request.owner_id.len() > 160 {
        return Err("Proprietário local inválido".into());
    }
    if request.original_filename.trim().is_empty() || request.original_filename.len() > 512 {
        return Err("Nome do arquivo inválido".into());
    }
    if request.mime_type != "application/pdf" && !request.mime_type.starts_with("image/") {
        return Err("Tipo de arquivo não suportado pelo armazenamento local".into());
    }
    if request.expected_size == 0 || request.expected_size > MAX_NATIVE_DOCUMENT_BYTES {
        return Err("Tamanho de arquivo inválido para armazenamento local".into());
    }
    if request
        .remote_document_id
        .as_ref()
        .is_some_and(|value| value.len() > 256)
        || request
            .drive_file_id
            .as_ref()
            .is_some_and(|value| value.len() > 512)
    {
        return Err("Referência remota inválida".into());
    }
    let remote_state = request
        .remote_state
        .as_deref()
        .unwrap_or("pending")
        .to_string();
    if !matches!(remote_state.as_str(), "pending" | "synced") {
        return Err("Estado remoto inválido".into());
    }
    Ok(remote_state)
}

pub fn begin_import(paths: &AppPaths, request: &BeginImportRequest) -> Result<(), String> {
    let remote_state = validate_begin(request)?;
    let relative_path = format!("staging/{}.part", request.document_id);
    let staging_path = paths::resolve_relative(&paths.root, &relative_path)?;
    if let Some(parent) = staging_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Não foi possível preparar a importação local: {error}"))?;
    }
    OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&staging_path)
        .map_err(|error| format!("Não foi possível iniciar a cópia local: {error}"))?;

    let result = catalog::begin_import(
        paths,
        &ImportSession {
            document_id: request.document_id.clone(),
            owner_id: request.owner_id.clone(),
            original_filename: request.original_filename.clone(),
            mime_type: request.mime_type.clone(),
            expected_size: request.expected_size as i64,
            written_bytes: 0,
            staging_relative_path: relative_path,
            remote_state,
            remote_document_id: request.remote_document_id.clone(),
            drive_file_id: request.drive_file_id.clone(),
        },
    );
    if result.is_err() {
        let _ = fs::remove_file(staging_path);
    }
    result
}

pub fn append_import(paths: &AppPaths, document_id: &str, chunk: &[u8]) -> Result<u64, String> {
    paths::validate_document_id(document_id)?;
    if chunk.is_empty() || chunk.len() > MAX_IPC_CHUNK_BYTES {
        return Err("Bloco de importação local inválido".into());
    }
    let session = catalog::get_import(paths, document_id)?
        .ok_or_else(|| "Importação local não encontrada".to_string())?;
    let current = u64::try_from(session.written_bytes).map_err(|_| "Estado de importação inválido")?;
    let expected = u64::try_from(session.expected_size).map_err(|_| "Estado de importação inválido")?;
    let next = current
        .checked_add(chunk.len() as u64)
        .ok_or_else(|| "Tamanho da importação excedeu o limite".to_string())?;
    if next > expected || next > MAX_NATIVE_DOCUMENT_BYTES {
        return Err("A cópia local excedeu o tamanho esperado".into());
    }
    let staging_path = paths::resolve_relative(&paths.root, &session.staging_relative_path)?;
    let metadata = fs::metadata(&staging_path)
        .map_err(|error| format!("Cópia local temporária indisponível: {error}"))?;
    if metadata.len() != current {
        return Err("A cópia local temporária ficou inconsistente".into());
    }
    let mut file = OpenOptions::new()
        .append(true)
        .open(&staging_path)
        .map_err(|error| format!("Não foi possível continuar a cópia local: {error}"))?;
    file.write_all(chunk)
        .and_then(|_| file.flush())
        .map_err(|error| format!("Não foi possível gravar o arquivo local: {error}"))?;
    catalog::update_import_written(paths, document_id, next as i64)?;
    Ok(next)
}

fn hash_file(path: &std::path::Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Não foi possível verificar o arquivo local: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Não foi possível verificar o arquivo local: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    buffer.fill(0);
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").map_err(|_| "Não foi possível codificar o hash local")?;
    }
    Ok(encoded)
}

pub fn finish_import(paths: &AppPaths, document_id: &str) -> Result<DocumentRow, String> {
    paths::validate_document_id(document_id)?;
    let session = catalog::get_import(paths, document_id)?
        .ok_or_else(|| "Importação local não encontrada".to_string())?;
    if session.written_bytes != session.expected_size || session.expected_size <= 0 {
        return Err("A cópia local ainda não terminou".into());
    }
    let staging_path = paths::resolve_relative(&paths.root, &session.staging_relative_path)?;
    let metadata = fs::metadata(&staging_path)
        .map_err(|error| format!("Cópia local temporária indisponível: {error}"))?;
    if metadata.len() != session.expected_size as u64 {
        return Err("O tamanho do arquivo local não corresponde ao esperado".into());
    }

    let sha256 = hash_file(&staging_path)?;
    let extension = paths::extension_for(&session.original_filename, &session.mime_type);
    let relative_path = format!(
        "documents/{}/{}.{}",
        session.document_id, sha256, extension
    );
    let destination = paths::resolve_relative(&paths.root, &relative_path)?;
    let parent = destination
        .parent()
        .ok_or_else(|| "Destino local inválido".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Não foi possível preparar o destino local: {error}"))?;

    if destination.exists() {
        let existing_size = fs::metadata(&destination)
            .map_err(|error| format!("Não foi possível verificar o destino local: {error}"))?
            .len();
        if existing_size != metadata.len() {
            return Err("Um arquivo local com o mesmo hash está inconsistente".into());
        }
        fs::remove_file(&staging_path)
            .map_err(|error| format!("Não foi possível finalizar a cópia local: {error}"))?;
    } else {
        fs::rename(&staging_path, &destination)
            .map_err(|error| format!("Não foi possível tornar a cópia local permanente: {error}"))?;
    }

    let old = catalog::get_document(paths, document_id)?;
    let now = catalog::now_ms();
    let document = DocumentRow {
        document_id: session.document_id,
        owner_id: session.owner_id,
        original_filename: session.original_filename,
        mime_type: session.mime_type,
        size_bytes: session.expected_size,
        sha256,
        relative_path: relative_path.clone(),
        local_state: "present".into(),
        remote_state: session.remote_state,
        remote_document_id: session.remote_document_id,
        drive_file_id: session.drive_file_id,
        created_at_ms: old.as_ref().map_or(now, |value| value.created_at_ms),
        updated_at_ms: now,
        last_accessed_at_ms: now,
    };
    catalog::commit_import(paths, &document)?;

    if let Some(previous) = old {
        if previous.relative_path != relative_path {
            if let Ok(previous_path) = paths::resolve_relative(&paths.root, &previous.relative_path) {
                let _ = fs::remove_file(previous_path);
            }
        }
    }
    Ok(document)
}

pub fn abort_import(paths: &AppPaths, document_id: &str) -> Result<(), String> {
    paths::validate_document_id(document_id)?;
    if let Some(session) = catalog::get_import(paths, document_id)? {
        if let Ok(path) = paths::resolve_relative(&paths.root, &session.staging_relative_path) {
            let _ = fs::remove_file(path);
        }
    }
    catalog::abort_import(paths, document_id)
}

fn validate_present_document(paths: &AppPaths, document: DocumentRow) -> Result<Option<DocumentRow>, String> {
    if document.local_state != "present" {
        return Ok(None);
    }
    let path = paths::resolve_relative(&paths.root, &document.relative_path)?;
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(_) => {
            catalog::set_local_state(paths, &document.document_id, "missing")?;
            return Ok(None);
        }
    };
    if metadata.len() != document.size_bytes as u64 {
        catalog::set_local_state(paths, &document.document_id, "corrupt")?;
        return Ok(None);
    }
    catalog::touch_document(paths, &document.document_id)?;
    Ok(Some(document))
}

pub fn local_document(paths: &AppPaths, document_id: &str) -> Result<Option<DocumentRow>, String> {
    paths::validate_document_id(document_id)?;
    let Some(document) = catalog::get_document(paths, document_id)? else {
        return Ok(None);
    };
    validate_present_document(paths, document)
}

pub fn local_document_by_drive_file_id(paths: &AppPaths, drive_file_id: &str) -> Result<Option<DocumentRow>, String> {
    let Some(document) = catalog::get_document_by_drive_file_id(paths, drive_file_id)? else {
        return Ok(None);
    };
    validate_present_document(paths, document)
}

pub fn read_range(
    paths: &AppPaths,
    document_id: &str,
    start: u64,
    end_exclusive: u64,
) -> Result<Vec<u8>, String> {
    let document = local_document(paths, document_id)?
        .ok_or_else(|| "Documento não está disponível localmente".to_string())?;
    let total = u64::try_from(document.size_bytes).map_err(|_| "Tamanho local inválido")?;
    if start >= end_exclusive || end_exclusive > total {
        return Err("Faixa local inválida".into());
    }
    let length = end_exclusive - start;
    if length > MAX_IPC_CHUNK_BYTES as u64 {
        return Err("Faixa local grande demais para uma única leitura".into());
    }
    let path = paths::resolve_relative(&paths.root, &document.relative_path)?;
    let mut file = File::open(path)
        .map_err(|error| format!("Não foi possível abrir o documento local: {error}"))?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| format!("Não foi possível posicionar a leitura local: {error}"))?;
    let mut bytes = vec![0_u8; length as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| format!("Não foi possível ler o documento local: {error}"))?;
    Ok(bytes)
}

pub fn verify_document(paths: &AppPaths, document_id: &str, full_hash: bool) -> Result<bool, String> {
    let Some(document) = local_document(paths, document_id)? else {
        return Ok(false);
    };
    if !full_hash {
        return Ok(true);
    }
    let path = paths::resolve_relative(&paths.root, &document.relative_path)?;
    let actual = hash_file(&path)?;
    if actual == document.sha256 {
        Ok(true)
    } else {
        catalog::set_local_state(paths, document_id, "corrupt")?;
        Ok(false)
    }
}

pub fn evict_document(paths: &AppPaths, document_id: &str) -> Result<(), String> {
    paths::validate_document_id(document_id)?;
    let document = catalog::get_document(paths, document_id)?
        .ok_or_else(|| "Documento local não encontrado".to_string())?;
    if document.remote_state != "synced" {
        return Err("O original ainda não possui uma cópia remota confirmada".into());
    }
    let path = paths::resolve_relative(&paths.root, &document.relative_path)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Não foi possível liberar o original local: {error}"))?;
    }
    catalog::set_local_state(paths, document_id, "missing")
}

pub fn disk_usage(paths: &AppPaths) -> Result<u64, String> {
    let documents = catalog::list_documents(paths, 1000)?;
    let document_bytes = documents
        .iter()
        .filter(|document| document.local_state == "present")
        .filter_map(|document| u64::try_from(document.size_bytes).ok())
        .sum::<u64>();
    let staging_bytes = fs::read_dir(&paths.staging)
        .map_err(|error| format!("Não foi possível calcular o uso local: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
        .sum::<u64>();
    Ok(document_bytes.saturating_add(staging_bytes))
}

pub fn cleanup_staging(paths: &AppPaths) -> Result<(), String> {
    for entry in fs::read_dir(&paths.staging)
        .map_err(|error| format!("Não foi possível verificar importações interrompidas: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Não foi possível ler a área temporária: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("Não foi possível verificar a área temporária: {error}"))?
            .is_file()
        {
            fs::remove_file(entry.path()).map_err(|error| {
                format!("Não foi possível limpar uma importação interrompida: {error}")
            })?;
        }
    }
    catalog::clear_import_sessions(paths)
}
