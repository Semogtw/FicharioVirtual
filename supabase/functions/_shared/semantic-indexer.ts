import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { embeddingVectorText, GeminiEmbeddingHttpError } from './gemini-embedding-client.ts';
import { chunkSemanticText } from './semantic-chunks.ts';
import {
	SEMANTIC_EMBEDDING_DIMENSIONS,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_INDEX_BATCH_PAGES,
	SEMANTIC_INDEX_PAGE_CONCURRENCY
} from './semantic-config.ts';
import { requestGeminiEmbeddingsWithTelemetry } from './semantic-provider-telemetry.ts';

type PendingPage = Readonly<{
	page_id: string;
	document_id: string;
	document_title: string;
	page_number: number;
	source_text: string;
	source_hash: string;
}>;

export type SemanticIndexBatchResult = Readonly<{
	attemptedPages: number;
	indexedPages: number;
	failedPages: number;
	storedChunks: number;
	rateLimited: boolean;
}>;

function asPendingPages(value: unknown): PendingPage[] {
	if (!Array.isArray(value)) return [];
	return value.filter((row): row is PendingPage => {
		if (!row || typeof row !== 'object') return false;
		const item = row as Record<string, unknown>;
		return (
			typeof item.page_id === 'string' &&
			typeof item.document_id === 'string' &&
			typeof item.document_title === 'string' &&
			typeof item.page_number === 'number' &&
			typeof item.source_text === 'string' &&
			typeof item.source_hash === 'string'
		);
	});
}

function failureStatus(cause: unknown) {
	if (cause instanceof GeminiEmbeddingHttpError) {
		if (cause.status === 429) return 'rate_limited';
		if (cause.status >= 500) return 'provider_http_error';
		return 'provider_rejected';
	}
	return 'index_error';
}

async function recordFailure(supabase: SupabaseClient, page: PendingPage, status: string) {
	try {
		await supabase.rpc('record_semantic_index_failure', {
			target_page_id: page.page_id,
			target_model: SEMANTIC_EMBEDDING_MODEL,
			failure_status: status
		});
	} catch {
		// Failure quarantine is best effort; the caller still reports the failed page.
	}
}

async function indexPage(input: {
	supabase: SupabaseClient;
	apiKey: string;
	page: PendingPage;
	surface: 'coverage' | 'search' | 'indexer';
	signal?: AbortSignal;
}) {
	const chunks = chunkSemanticText(input.page.source_text);
	if (chunks.length === 0) return { indexed: false, storedChunks: 0 };

	const vectors = await requestGeminiEmbeddingsWithTelemetry({
		supabase: input.supabase,
		apiKey: input.apiKey,
		model: SEMANTIC_EMBEDDING_MODEL,
		inputs: chunks.map((chunk) => ({
			text: chunk.text,
			title: input.page.document_title
		})),
		taskType: 'RETRIEVAL_DOCUMENT',
		outputDimensionality: SEMANTIC_EMBEDDING_DIMENSIONS,
		operation: 'document_embedding',
		surface: input.surface,
		...(input.signal ? { signal: input.signal } : {})
	});

	if (vectors.length !== chunks.length) {
		throw new Error('semantic_embedding_count_mismatch');
	}

	const chunkPayload = chunks.map((chunk, index) => {
		const vector = vectors[index];
		if (!vector) throw new Error('semantic_embedding_missing');
		return {
			chunk_index: chunk.index,
			chunk_text: chunk.text,
			embedding_text: embeddingVectorText(vector)
		};
	});
	const { data, error } = await input.supabase.rpc('replace_page_semantic_chunks', {
		target_page_id: input.page.page_id,
		target_model: SEMANTIC_EMBEDDING_MODEL,
		target_source_hash: input.page.source_hash,
		chunk_payload: chunkPayload
	});
	if (error) throw error;
	const storedChunks = typeof data === 'number' ? data : Number(data ?? 0);
	return { indexed: storedChunks > 0, storedChunks: Math.max(0, storedChunks) };
}

export async function indexNextSemanticBatch(input: {
	supabase: SupabaseClient;
	apiKey: string;
	notebookId?: string | null;
	batchPages?: number;
	concurrency?: number;
	surface: 'coverage' | 'search' | 'indexer';
	signal?: AbortSignal;
}): Promise<SemanticIndexBatchResult> {
	const batchPages = Math.max(
		1,
		Math.min(24, Math.round(input.batchPages ?? SEMANTIC_INDEX_BATCH_PAGES))
	);
	const concurrency = Math.max(
		1,
		Math.min(4, Math.round(input.concurrency ?? SEMANTIC_INDEX_PAGE_CONCURRENCY))
	);
	const { data, error } = await input.supabase.rpc('list_pages_needing_semantic_index', {
		target_model: SEMANTIC_EMBEDDING_MODEL,
		notebook_filter: input.notebookId ?? null,
		result_limit: batchPages
	});
	if (error) throw error;
	const pages = asPendingPages(data).slice(0, batchPages);
	if (pages.length === 0) {
		return {
			attemptedPages: 0,
			indexedPages: 0,
			failedPages: 0,
			storedChunks: 0,
			rateLimited: false
		};
	}

	let cursor = 0;
	let indexedPages = 0;
	let failedPages = 0;
	let storedChunks = 0;
	let rateLimited = false;

	async function worker() {
		while (!rateLimited) {
			const index = cursor++;
			const page = pages[index];
			if (!page) return;
			try {
				const result = await indexPage({ ...input, page });
				if (result.indexed) indexedPages += 1;
				else failedPages += 1;
				storedChunks += result.storedChunks;
			} catch (cause) {
				if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
				failedPages += 1;
				await recordFailure(input.supabase, page, failureStatus(cause));
				if (cause instanceof GeminiEmbeddingHttpError && cause.status === 429) {
					rateLimited = true;
					return;
				}
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, () => worker()));
	return {
		attemptedPages: Math.min(cursor, pages.length),
		indexedPages,
		failedPages,
		storedChunks,
		rateLimited
	};
}

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
	return {
		totalPages,
		indexedPages,
		remainingPages: Math.max(0, totalPages - indexedPages),
		coverage: totalPages === 0 ? 1 : indexedPages / totalPages
	};
}
