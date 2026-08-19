import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { SEMANTIC_EMBEDDING_MODEL } from './semantic-config.ts';

export async function semanticIndexStats(
	supabase: SupabaseClient,
	notebookId: string | null = null
) {
	const { data, error } = await supabase.rpc('semantic_index_stats', {
		target_model: SEMANTIC_EMBEDDING_MODEL,
		notebook_filter: notebookId
	});
	if (error) throw error;
	const row = Array.isArray(data) ? data[0] : data;
	const record = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
	const totalPages = Math.max(0, Number(record.total_pages ?? 0));
	const indexedPages = Math.max(0, Number(record.indexed_pages ?? 0));
	return Object.freeze({
		totalPages,
		indexedPages,
		remainingPages: Math.max(0, totalPages - indexedPages),
		coverage: totalPages === 0 ? 1 : indexedPages / totalPages
	});
}
