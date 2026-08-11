import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coverageEdge = readFileSync('supabase/functions/semantic-coverage/index.ts', 'utf8');
const indexEdge = readFileSync('supabase/functions/semantic-index/index.ts', 'utf8');
const queryCache = readFileSync('supabase/functions/_shared/semantic-query-cache.ts', 'utf8');
const verifier = readFileSync('supabase/functions/_shared/gemini-coverage-verifier.ts', 'utf8');
const retryMigration = readFileSync(
	'supabase/migrations/202608102001_semantic_index_retry_hardening.sql',
	'utf8'
);

describe('semantic production Edge Function contracts', () => {
	it('uses the shared indexer, query cache, model contract and RRF in topic coverage', () => {
		expect(coverageEdge).toContain("from '../_shared/semantic-indexer.ts'");
		expect(coverageEdge).toContain("from '../_shared/semantic-query-cache.ts'");
		expect(coverageEdge).toContain("from '../_shared/semantic-ranking.ts'");
		expect(coverageEdge).toContain('SEMANTIC_EMBEDDING_MODEL');
		expect(coverageEdge).toContain('getSemanticQueryEmbeddings({');
		expect(coverageEdge).toContain('compareHybridRanked');
		expect(coverageEdge).not.toContain("Deno.env.get('SEMANTIC_EMBEDDING_MODEL')");
		expect(coverageEdge).not.toContain("from '../_shared/semantic-provider-telemetry.ts'");
		expect(coverageEdge).not.toContain("from '../_shared/semantic-chunks.ts'");
	});

	it('batches cold query embeddings while preserving per-query cache keys', () => {
		expect(queryCache).toContain('export async function getSemanticQueryEmbeddings');
		expect(queryCache).toContain('const misses = unique.filter');
		expect(queryCache).toContain('inputs: misses.map');
		expect(queryCache).toContain('Promise.all(writes)');
	});

	it('quarantines failing pages and stops a run that makes no progress', () => {
		expect(retryMigration).toContain('create table public.semantic_index_failures');
		expect(retryMigration).toContain('retry_after > now()');
		expect(retryMigration).toContain('record_semantic_index_failure');
		expect(indexEdge).toContain("stopReason = 'no_progress'");
		expect(indexEdge).toContain('if (result.indexedPages === 0)');
	});

	it('keeps retrieval stats private behind an authorized security-definer RPC', () => {
		expect(retryMigration).toContain('create or replace function public.semantic_retrieval_stats');
		expect(retryMigration).toContain('security definer');
		expect(retryMigration).toContain("raise exception 'Not authorized'");
		expect(retryMigration).toContain(
		'revoke all on table public.semantic_index_failures from public, anon, authenticated'
	);
	});

	it('bounds Gemini verifier output tokens', () => {
		expect(verifier).toContain('maxOutputTokens: 2_048');
	});
});
