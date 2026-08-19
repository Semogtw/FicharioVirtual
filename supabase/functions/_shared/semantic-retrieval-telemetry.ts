import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type SemanticRetrievalMode = 'lexical' | 'semantic' | 'hybrid' | 'fallback' | 'indexing';
export type SemanticRetrievalSurface = 'global_search' | 'topic_coverage' | 'indexer';

export async function recordSemanticRetrievalEvent(
	supabase: SupabaseClient,
	input: {
		surface: SemanticRetrievalSurface;
		mode: SemanticRetrievalMode;
		model: string | null;
		resultCount?: number;
		lexicalOnlyCount?: number;
		semanticOnlyCount?: number;
		hybridCount?: number;
		totalPages?: number | null;
		indexedPages?: number | null;
		durationMs: number;
		queryEmbeddingCacheHit?: boolean | null;
		fallbackReason?: string | null;
	}
) {
	try {
		await supabase.rpc('record_semantic_retrieval_event', {
			event_surface: input.surface,
			event_mode: input.mode,
			event_model: input.model ?? '',
			event_result_count: Math.max(0, Math.round(input.resultCount ?? 0)),
			event_lexical_only_count: Math.max(0, Math.round(input.lexicalOnlyCount ?? 0)),
			event_semantic_only_count: Math.max(0, Math.round(input.semanticOnlyCount ?? 0)),
			event_hybrid_count: Math.max(0, Math.round(input.hybridCount ?? 0)),
			event_total_pages:
				input.totalPages == null ? null : Math.max(0, Math.round(input.totalPages)),
			event_indexed_pages:
				input.indexedPages == null ? null : Math.max(0, Math.round(input.indexedPages)),
			event_duration_ms: Math.max(0, Math.min(300_000, Math.round(input.durationMs))),
			event_query_embedding_cache_hit: input.queryEmbeddingCacheHit ?? null,
			event_fallback_reason: input.fallbackReason ?? null
		});
	} catch {
		// Retrieval telemetry is best effort and must never alter user-visible results.
	}
}
