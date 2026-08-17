import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edge = readFileSync('supabase/functions/semantic-search/index.ts', 'utf8');
const backgroundIndexer = readFileSync(
	'supabase/functions/_shared/background-semantic-indexer.ts',
	'utf8'
);
const queryCache = readFileSync('supabase/functions/_shared/semantic-query-cache.ts', 'utf8');

describe('global semantic search edge contract', () => {
	it('retrieves document-first with embeddings instead of classifying repeated page candidates', () => {
		expect(edge).toContain('getSemanticQueryEmbedding');
		expect(queryCache).toContain("taskType: 'RETRIEVAL_QUERY'");
		expect(queryCache).toContain("operation: 'query_embedding'");
		expect(edge).toContain("supabase.rpc('search_documents_semantic'");
		expect(edge).toContain("supabase.rpc('search_documents'");
		expect(edge).toContain("supabase.rpc('search_documents_visual_semantic'");
		expect(edge).toContain("visualMode === 'active' ? visibleVisual : []");
		expect(edge).toContain("matchMode: 'semantic'");
		expect(edge).toContain('merged.set(row.document_id, candidate)');
		expect(edge).toContain('hybridPrecisionPolicy(lexical)');
		expect(edge).toContain('applyHybridPrecision(semantic, precisionPolicy)');
	});

	it('keeps document embedding out of interactive search requests', () => {
		expect(edge).not.toContain('indexNextSemanticBatch');
		expect(edge).not.toContain("taskType: 'RETRIEVAL_DOCUMENT'");
		expect(backgroundIndexer).toContain("taskType: 'RETRIEVAL_DOCUMENT'");
	});

	it('does not query semantic coverage statistics on the interactive hot path', () => {
		expect(edge).not.toContain('semanticIndexStats');
		expect(edge).toContain('index: null');
		expect(edge).toContain('totalPages: null');
		expect(edge).toContain('indexedPages: null');
	});

	it('does not retain a pre-launch semantic consent gate', () => {
		expect(edge).not.toContain('has_search_semantic_consent');
		expect(edge).not.toContain('consent_required');
		expect(edge).not.toContain('record_search_semantic_consent');
		expect(edge).toContain('getSemanticQueryEmbedding({');
	});

	it('keeps textual fallback for short queries, quota and provider failures', () => {
		expect(edge).toContain("reason = 'query_too_short'");
		expect(edge).toContain("'semantic_quota_or_rate_limit'");
		expect(edge).toContain("'semantic_provider_unavailable'");
		expect(edge).toContain("mode: 'lexical'");
	});
});
