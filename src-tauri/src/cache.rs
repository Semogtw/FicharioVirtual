use serde::Serialize;
use std::fs;

use crate::{catalog, paths};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheTrimResult {
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub released_bytes: u64,
    pub evicted_documents: usize,
    pub protected_documents: usize,
}

fn present_bytes(documents: &[catalog::DocumentRow]) -> u64 {
    documents
        .iter()
        .filter(|document| document.local_state == "present")
        .filter_map(|document| u64::try_from(document.size_bytes).ok())
        .sum()
}

pub fn trim(paths: &paths::AppPaths, target_bytes: u64) -> Result<CacheTrimResult, String> {
    let mut documents = catalog::list_documents(paths, 1000)?;
    let before_bytes = present_bytes(&documents);
    if before_bytes <= target_bytes {
        return Ok(CacheTrimResult {
            before_bytes,
            after_bytes: before_bytes,
            released_bytes: 0,
            evicted_documents: 0,
            protected_documents: documents
                .iter()
                .filter(|document| document.local_state == "present" && document.remote_state != "synced")
                .count(),
        });
    }

    documents.sort_by_key(|document| document.last_accessed_at_ms);
    let protected_documents = documents
        .iter()
        .filter(|document| document.local_state == "present" && document.remote_state != "synced")
        .count();
    let mut current_bytes = before_bytes;
    let mut evicted_documents = 0usize;

    for document in documents {
        if current_bytes <= target_bytes {
            break;
        }
        if document.local_state != "present" || document.remote_state != "synced" {
            continue;
        }
        let size = match u64::try_from(document.size_bytes) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = paths::resolve_relative(&paths.root, &document.relative_path)?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Não foi possível liberar um documento local com segurança: {error}"
                ));
            }
        }
        catalog::set_local_state(paths, &document.document_id, "missing")?;
        current_bytes = current_bytes.saturating_sub(size);
        evicted_documents += 1;
    }

    Ok(CacheTrimResult {
        before_bytes,
        after_bytes: current_bytes,
        released_bytes: before_bytes.saturating_sub(current_bytes),
        evicted_documents,
        protected_documents,
    })
}
