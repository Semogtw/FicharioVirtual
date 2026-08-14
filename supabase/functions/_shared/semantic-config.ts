export const SEMANTIC_EMBEDDING_MODEL = 'gemini-embedding-2';
export const SEMANTIC_EMBEDDING_DIMENSIONS = 768;

export const SEMANTIC_QUERY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SEMANTIC_QUERY_CACHE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const SEMANTIC_INDEX_MAX_BATCHES = 12;
export const SEMANTIC_INDEX_PAGE_CONCURRENCY = 3;
export const SEMANTIC_INDEX_MAX_CHUNKS_PER_REQUEST = 64;

export const SEMANTIC_SEARCH_MIN_SIMILARITY = 0.46;
// Calibrated against the 2026-08-14 real staging visual corpus: the weakest
// relevant page scored 0.3617 while the strongest negative query candidate
// scored 0.3494. Keep a small conservative margin without discarding the
// cross-modal signal, whose useful score range is lower than text-to-text.
export const SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY = 0.36;
export const SEMANTIC_COVERAGE_MIN_SIMILARITY = 0.5;
export const SEMANTIC_HNSW_EF_SEARCH = 80;

export const SEMANTIC_RRF_K = 28;
export const SEMANTIC_RRF_LEXICAL_WEIGHT = 0.48;
export const SEMANTIC_RRF_VECTOR_WEIGHT = 0.52;
export const SEMANTIC_RRF_BOTH_BONUS = 0.012;
// Visual rank stays just below a pure lexical rank, while similarity above the
// calibrated cross-modal floor supplies bounded confidence. This keeps exact
// text hits stable but lets strong visual-only evidence beat weak OCR semantics.
export const SEMANTIC_RRF_VISUAL_WEIGHT = 0.475;
export const SEMANTIC_RRF_VISUAL_BONUS = 0.0002;
export const SEMANTIC_RRF_VISUAL_CONFIDENCE_WEIGHT = 0.04;
export const SEMANTIC_RRF_VISUAL_CONFIDENCE_MARGIN_CAP = 0.1;
export const SEMANTIC_RRF_EXACT_LEXICAL_GUARD_BONUS = 0.0045;
