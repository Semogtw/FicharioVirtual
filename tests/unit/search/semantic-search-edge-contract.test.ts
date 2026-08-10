import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edge = readFileSync('supabase/functions/semantic-search/index.ts', 'utf8');
const migration = readFileSync(
	'supabase/migrations/202608101501_global_semantic_search_consent.sql',
	'utf8'
);

describe('global semantic search edge contract', () => {
	it('retrieves with embeddings instead of only classifying lexical candidates', () => {
		expect(edge).toContain("taskType: 'RETRIEVAL_QUERY'");
		expect(edge).toContain("supabase.rpc('search_pages_semantic'");
		expect(edge).toContain("supabase.rpc('search_pages'");
		expect(edge).toContain('mergeCandidates(lexical, semantic)');
		expect(edge).toContain("matchMode: 'semantic'");
		expect(edge).not.toContain('requestGeminiCoverageVerification');
	});

	it('reuses the coverage semantic index and keeps opportunistic indexing page-atomic', () => {
		expect(edge).toContain("supabase.rpc('list_pages_needing_semantic_index'");
		expect(edge).toContain("'replace_page_semantic_chunks'");
		expect(edge).toContain('flattened.length + chunks.length > MAX_INDEX_CHUNKS_PER_RUN');
		expect(edge).toContain("surface: 'search'");
	});

	it('requires dedicated consent before sending query or page text to Gemini', () => {
		const consentCheck = edge.indexOf("supabase.rpc('has_search_semantic_consent'");
		const documentEmbedding = edge.indexOf('indexedThisRun = await indexPages');
		const queryEmbedding = edge.indexOf("taskType: 'RETRIEVAL_QUERY'");
		expect(consentCheck).toBeGreaterThan(0);
		expect(documentEmbedding).toBeGreaterThan(consentCheck);
		expect(queryEmbedding).toBeGreaterThan(consentCheck);
		expect(migration).toContain('security definer');
		expect(migration).toContain('record_search_semantic_consent');
		expect(migration).toContain('has_search_semantic_consent');
		expect(migration).toContain(
			'revoke execute on function public.record_search_semantic_consent(integer) from public, anon;'
		);
	});

	it('keeps textual fallback for short queries, quota and provider failures', () => {
		expect(edge).toContain("reason = 'query_too_short'");
		expect(edge).toContain("'semantic_quota_or_rate_limit'");
		expect(edge).toContain("'semantic_provider_unavailable'");
		expect(edge).toContain("mode: 'lexical'");
	});
});
