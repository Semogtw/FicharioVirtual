import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coverageEdge = readFileSync('supabase/functions/semantic-coverage/index.ts', 'utf8');
const queryCache = readFileSync('supabase/functions/_shared/semantic-query-cache.ts', 'utf8');
const backgroundIndexer = readFileSync(
	'supabase/functions/_shared/background-semantic-indexer.ts',
	'utf8'
);
const retiredIndexEdge = readFileSync('supabase/functions/semantic-index/index.ts', 'utf8');
const retryMigration = readFileSync(
	'supabase/migrations/202608102001_semantic_index_retry_hardening.sql',
	'utf8'
);

describe('semantic production Edge Function contracts', () => {
	it('uses query embeddings and RRF without indexing documents during coverage', () => {
		expect(coverageEdge).toContain("from '../_shared/semantic-query-cache.ts'");
		expect(coverageEdge).toContain("from '../_shared/semantic-ranking.ts'");
		expect(coverageEdge).toContain('SEMANTIC_EMBEDDING_MODEL');
		expect(coverageEdge).toContain('getSemanticQueryEmbeddings({');
		expect(coverageEdge).toContain('compareHybridRanked');
		expect(coverageEdge).not.toContain('indexNextSemanticBatch');
		expect(coverageEdge).not.toContain('requestGeminiCoverageVerification');
	});

	it('batches cold query embeddings while preserving per-query cache keys', () => {
		expect(queryCache).toContain('export async function getSemanticQueryEmbeddings');
		expect(queryCache).toContain('const misses = unique.filter');
		expect(queryCache).toContain('inputs: misses.map');
		expect(queryCache).toContain('Promise.all(writes)');
	});

	it('keeps document indexing exclusively in the background worker path', () => {
		expect(backgroundIndexer).toContain("taskType: 'RETRIEVAL_DOCUMENT'");
		expect(backgroundIndexer).toContain("'replace'");
		expect(backgroundIndexer).toContain("'record_failure'");
		expect(retiredIndexEdge).toContain("code: 'semantic_index_retired'");
		expect(retiredIndexEdge).toContain('410');
	});

	it('keeps retry state private', () => {
		expect(retryMigration).toContain('create table public.semantic_index_failures');
		expect(retryMigration).toContain('retry_after > now()');
		expect(retryMigration).toContain('record_semantic_index_failure');
		expect(retryMigration).toContain(
			'revoke all on table public.semantic_index_failures from public, anon, authenticated'
		);
	});
});
