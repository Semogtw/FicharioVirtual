import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { embeddingVectorText } from './gemini-embedding-client.ts';
import { requestGeminiEmbeddingsWithTelemetry } from './semantic-provider-telemetry.ts';
import {
	SEMANTIC_EMBEDDING_DIMENSIONS,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_QUERY_CACHE_TTL_SECONDS
} from './semantic-config.ts';

function normalizeQuery(value: string) {
	return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('pt-BR');
}

async function sha256(value: string) {
	const encoded = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', encoded);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getSemanticQueryEmbedding(input: {
	supabase: SupabaseClient;
	apiKey: string;
	query: string;
	surface: 'coverage' | 'search';
	signal?: AbortSignal;
}) {
	const normalized = normalizeQuery(input.query);
	const queryHash = await sha256(`${SEMANTIC_EMBEDDING_MODEL}\n${normalized}`);

	try {
		const { data, error } = await input.supabase.rpc('get_cached_semantic_query_embedding', {
			target_model: SEMANTIC_EMBEDDING_MODEL,
			target_query_hash: queryHash
		});
		if (!error && typeof data === 'string' && data.startsWith('[') && data.endsWith(']')) {
			return { vectorText: data, cacheHit: true, queryHash } as const;
		}
	} catch {
		// A cache miss/failure must never block retrieval.
	}

	const result = await requestGeminiEmbeddingsWithTelemetry({
		supabase: input.supabase,
		apiKey: input.apiKey,
		model: SEMANTIC_EMBEDDING_MODEL,
		inputs: [{ text: input.query }],
		taskType: 'RETRIEVAL_QUERY',
		outputDimensionality: SEMANTIC_EMBEDDING_DIMENSIONS,
		operation: 'query_embedding',
		surface: input.surface,
		...(input.signal ? { signal: input.signal } : {})
	});
	const vectorText = embeddingVectorText(result.embeddings[0]);

	try {
		await input.supabase.rpc('put_cached_semantic_query_embedding', {
			target_model: SEMANTIC_EMBEDDING_MODEL,
			target_query_hash: queryHash,
			embedding_text: vectorText,
			ttl_seconds: SEMANTIC_QUERY_CACHE_TTL_SECONDS
		});
	} catch {
		// Cache writes are best effort.
	}

	return { vectorText, cacheHit: false, queryHash } as const;
}
