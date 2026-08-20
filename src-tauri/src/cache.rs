use serde::Serialize;
use std::fs;

use crate::{catalog, metrics, paths};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheTrimResult {
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub released_bytes: u64,
    pub evicted_documents: usize,
    pub protected_documents: usize,
}

pub fn trim(paths: &paths::AppPaths, target_bytes: u64) -> Result<CacheTrimResult, String> {
    let summary = metrics::read(paths)?;
    let before_bytes = summary.present_document_bytes;
    if before_bytes <= target_bytes {
        return Ok(CacheTrimResult {
            before_bytes,
            after_bytes: before_bytes,
            released_bytes: 0,
            evicted_documents: 0,
            protected_documents: summary.protected_document_count,
        });
    }

    let mut current_bytes = before_bytes;
    let mut evicted_documents = 0usize;

    while current_bytes > target_bytes {
        let batch = metrics::list_oldest_evictable(paths, 256)?;
        if batch.is_empty() {
            break;
        }
        let mut batch_released = 0_u64;
        for document in batch {
            if current_bytes <= target_bytes {
                break;
            }
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
            current_bytes = current_bytes.saturating_sub(document.size_bytes);
            batch_released = batch_released.saturating_add(document.size_bytes);
            evicted_documents = evicted_documents.saturating_add(1);
        }
        if batch_released == 0 {
            break;
        }
    }

    Ok(CacheTrimResult {
        before_bytes,
        after_bytes: current_bytes,
        released_bytes: before_bytes.saturating_sub(current_bytes),
        evicted_documents,
        protected_documents: summary.protected_document_count,
    })
}
