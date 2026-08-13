import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/202608101444_semantic_provider_telemetry.sql',
	'utf8'
);
const recorder = readFileSync(
	'supabase/functions/_shared/semantic-provider-telemetry.ts',
	'utf8'
);
const indexer = readFileSync(
	'supabase/functions/_shared/background-semantic-indexer.ts',
	'utf8'
);
const queryCache = readFileSync('supabase/functions/_shared/semantic-query-cache.ts', 'utf8');

describe('semantic provider telemetry contract', () => {
	it('stores quota-relevant metadata without storing query or document content', () => {
		const table = migration.match(
			/create table public\.semantic_provider_usage_events \([\s\S]*?\n\);/
		)?.[0];
		expect(table).toBeTruthy();
		expect(table).toContain('operation text');
		expect(table).toContain('input_count integer');
		expect(table).toContain('input_characters bigint');
		expect(table).toContain('input_bytes bigint');
		expect(table).toContain('output_dimensions integer');
		expect(table).toContain('latency_ms integer');
		expect(table).not.toContain('query_text');
		expect(table).not.toContain('chunk_text');
		expect(table).not.toContain('embedding vector');
	});

	it('keeps telemetry best effort and classifies provider rate limits', () => {
		expect(recorder).toContain("error.status === 429 ? 'rate_limited'");
		expect(recorder).toContain("supabase.rpc('record_semantic_provider_usage'");
		expect(recorder).toContain('Telemetry is best effort');
		expect(recorder).toContain('target_input_characters');
		expect(recorder).toContain('target_input_bytes');
	});

	it('keeps document embeddings background-only while query embeddings retain telemetry', () => {
		expect(indexer).toContain("taskType: 'RETRIEVAL_DOCUMENT'");
		expect(queryCache).toContain("operation: 'query_embedding'");
		expect(queryCache).toContain("taskType: 'RETRIEVAL_QUERY'");
		expect(indexer.match(/requestGeminiEmbeddings\(/g)).toHaveLength(1);
		expect(queryCache.match(/requestGeminiEmbeddingsWithTelemetry\(/g)).toHaveLength(1);
	});

	it('provides an aggregate view of requests, errors and rate limiting', () => {
		expect(migration).toContain('semantic_provider_usage_summary');
		expect(migration).toContain('request_count bigint');
		expect(migration).toContain('rate_limited_count bigint');
		expect(migration).toContain('input_characters bigint');
	});
});
