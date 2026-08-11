import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edge = readFileSync('supabase/functions/semantic-search/index.ts', 'utf8');
const indexer = readFileSync('supabase/functions/_shared/semantic-indexer.ts', 'utf8');
const queryCache = readFileSync('supabase/functions/_shared/semantic-query-cache.ts', 'utf8');

describe('global semantic search edge contract', () => {
	it('retrieves with embeddings instead of only classifying lexical candidates', () => {
		expect(edge).toContain('getSemanticQueryEmbedding');
		expect(queryCache).toContain("taskType: 'RETRIEVAL_QUERY'");
		expect(queryCache).toContain("operation: 'query_embedding'");
		expect(edge).toContain("supabase.rpc('search_pages_semantic'");
		expect(edge).toContain("supabase.rpc('search_pages'");
		expect(edge).toContain('mergeCandidates(lexical, semantic)');
		expect(edge).toContain("matchMode: 'semantic'");
		expect(edge).not.toContain('requestGeminiCoverageVerification');
	});

	it('reuses the coverage semantic index and keeps opportunistic indexing page-atomic', () => {
		expect(edge).toContain('indexNextSemanticBatch');
		expect(indexer).toContain("supabase.rpc('list_pages_needing_semantic_index'");
		expect(indexer).toContain("'replace_page_semantic_chunks'");
		expect(indexer).toContain("taskType: 'RETRIEVAL_DOCUMENT'");
		expect(indexer).toContain("operation: 'document_embedding'");
		expect(edge).toContain("surface: 'search'");
	});

	it('does not retain a pre-launch semantic consent gate', () => {
		expect(edge).not.toContain('has_search_semantic_consent');
		expect(edge).not.toContain('consent_required');
		expect(edge).not.toContain('record_search_semantic_consent');
		expect(edge.indexOf('indexNextSemanticBatch({')).toBeGreaterThan(0);
		expect(edge.indexOf('getSemanticQueryEmbedding({')).toBeGreaterThan(0);
	});

	it('keeps textual fallback for short queries, quota and provider failures', () => {
		expect(edge).toContain("reason = 'query_too_short'");
		expect(edge).toContain("'semantic_quota_or_rate_limit'");
		expect(edge).toContain("'semantic_provider_unavailable'");
		expect(edge).toContain("mode: 'lexical'");
	});
});
