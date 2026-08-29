use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub const MAX_NATIVE_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub documents: PathBuf,
    pub staging: PathBuf,
}

pub fn ensure(app: &AppHandle) -> Result<AppPaths, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível localizar os dados do aplicativo: {error}"))?;
    let root = base.join("native-v1");
    let documents = root.join("documents");
    let staging = root.join("staging");
    fs::create_dir_all(&documents)
        .and_then(|_| fs::create_dir_all(&staging))
        .map_err(|error| format!("Não foi possível preparar o armazenamento local: {error}"))?;
    Ok(AppPaths {
        database: root.join("catalog.sqlite3"),
        root,
        documents,
        staging,
    })
}

pub fn validate_document_id(document_id: &str) -> Result<(), String> {
    if document_id.is_empty() || document_id.len() > 128 {
        return Err("Identificador de documento inválido".into());
    }
    if !document_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Identificador de documento inválido".into());
    }
    Ok(())
}

pub fn resolve_relative(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("Caminho local inválido".into());
    }
    let mut resolved = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            _ => return Err("Caminho local inválido".into()),
        }
    }
    Ok(resolved)
}

pub fn extension_for(original_filename: &str, mime_type: &str) -> &'static str {
    match mime_type {
        "application/pdf" => "pdf",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        "image/avif" => "avif",
        "image/heic" => "heic",
        "image/heif" => "heif",
        _ => {
            let extension = Path::new(original_filename)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            match extension.as_str() {
                "pdf" => "pdf",
                "jpg" | "jpeg" => "jpg",
                "png" => "png",
                "webp" => "webp",
                "gif" => "gif",
                "bmp" => "bmp",
                "tif" | "tiff" => "tiff",
                "avif" => "avif",
                "heic" => "heic",
                "heif" => "heif",
                _ => "bin",
            }
        }
    }
}
