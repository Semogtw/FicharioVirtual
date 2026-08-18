import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { embeddingVectorText } from './gemini-embedding-client.ts';
import { requestGeminiEmbeddingsWithTelemetry } from './semantic-provider-telemetry.ts';
import {
	SEMANTIC_EMBEDDING_DIMENSIONS,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_QUERY_CACHE_TTL_SECONDS
} from './semantic-config.ts';
import { normalizeSemanticQueryText } from './semantic-text.ts';

export type SemanticQueryEmbedding = Readonly<{
	vectorText: string;
	cacheHit: boolean;
	queryHash: string;
}>;

const SEMANTIC_QUERY_TEXT_VERSION = 'v2';

async function sha256(value: string) {
	const encoded = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', encoded);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validCachedVector(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.startsWith('[') &&
		value.endsWith(']') &&
		value.length <= 24_000
	);
}

export async function getSemanticQueryEmbeddings(input: {
	supabase: SupabaseClient;
	apiKey: string;
	queries: readonly string[];
	surface: 'coverage' | 'search';
	signal?: AbortSignal;
}): Promise<readonly SemanticQueryEmbedding[]> {
	if (input.queries.length === 0) return Object.freeze([]);

	const entries = await Promise.all(
		input.queries.map(async (query, index) => {
			const embeddingText = normalizeSemanticQueryText(query);
			if (!embeddingText) throw new Error('Semantic query is empty after normalization');
			const queryHash = await sha256(
				`${SEMANTIC_EMBEDDING_MODEL}\n${SEMANTIC_QUERY_TEXT_VERSION}\n${embeddingText}`
			);
			return { index, embeddingText, queryHash };
		})
	);
	const unique = [...new Map(entries.map((entry) => [entry.queryHash, entry])).values()];
	const resolved = new Map<string, SemanticQueryEmbedding>();

	await Promise.all(
		unique.map(async (entry) => {
			try {
				const { data, error } = await input.supabase.rpc('get_cached_semantic_query_embedding', {
					target_model: SEMANTIC_EMBEDDING_MODEL,
					target_query_hash: entry.queryHash
				});
				if (!error && validCachedVector(data)) {
					resolved.set(
						entry.queryHash,
						Object.freeze({ vectorText: data, cacheHit: true, queryHash: entry.queryHash })
					);
				}
			} catch {
				// Cache reads are best effort and must never block retrieval.
			}
		})
	);

	const misses = unique.filter((entry) => !resolved.has(entry.queryHash));
	if (misses.length > 0) {
		const vectors = await requestGeminiEmbeddingsWithTelemetry({
			supabase: input.supabase,
			apiKey: input.apiKey,
			model: SEMANTIC_EMBEDDING_MODEL,
			inputs: misses.map((entry) => ({ text: entry.embeddingText })),
			taskType: 'RETRIEVAL_QUERY',
			outputDimensionality: SEMANTIC_EMBEDDING_DIMENSIONS,
			operation: 'query_embedding',
			surface: input.surface,
			...(input.signal ? { signal: input.signal } : {})
		});

		if (vectors.length !== misses.length) {
			throw new Error('Semantic query embedding count mismatch');
		}

		for (const [missIndex, entry] of misses.entries()) {
			const vector = vectors[missIndex];
			if (!vector) throw new Error('Semantic query embedding missing');
			const vectorText = embeddingVectorText(vector);
			resolved.set(
				entry.queryHash,
				Object.freeze({ vectorText, cacheHit: false, queryHash: entry.queryHash })
			);
			void input.supabase
				.rpc('put_cached_semantic_query_embedding', {
					target_model: SEMANTIC_EMBEDDING_MODEL,
					target_query_hash: entry.queryHash,
					embedding_text: vectorText,
					ttl_seconds: SEMANTIC_QUERY_CACHE_TTL_SECONDS
				})
				.catch(() => undefined);
		}
	}

	return Object.freeze(
		entries.map((entry) => {
			const value = resolved.get(entry.queryHash);
			if (!value) throw new Error('Semantic query embedding missing');
			return value;
		})
	);
}

export async function getSemanticQueryEmbedding(input: {
	supabase: SupabaseClient;
	apiKey: string;
	query: string;
	surface: 'coverage' | 'search';
	signal?: AbortSignal;
}) {
	const [embedding] = await getSemanticQueryEmbeddings({
		supabase: input.supabase,
		apiKey: input.apiKey,
		queries: [input.query],
		surface: input.surface,
		...(input.signal ? { signal: input.signal } : {})
	});
	if (!embedding) throw new Error('Semantic query embedding missing');
	return embedding;
}
