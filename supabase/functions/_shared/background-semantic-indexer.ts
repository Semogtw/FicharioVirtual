import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
	embeddingVectorText,
	GeminiEmbeddingHttpError,
	requestGeminiEmbeddings
} from './gemini-embedding-client.ts';
import { chunkSemanticText } from './semantic-chunks.ts';
import {
	SEMANTIC_EMBEDDING_DIMENSIONS,
	SEMANTIC_EMBEDDING_MODEL
} from './semantic-config.ts';

type PendingPage = Readonly<{
	page_id: string;
	document_id: string;
	document_title: string;
	page_number: number;
	source_text: string;
	source_hash: string;
}>;

type BackgroundResult = Readonly<{
	processedUserId: string | null;
	attemptedPages: number;
	indexedPages: number;
	failedPages: number;
	storedChunks: number;
	rateLimited: boolean;
	hasMore: boolean;
}>;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseUserId(value: unknown) {
	if (!Array.isArray(value)) return null;
	for (const item of value) {
		const row = record(item);
		if (row && typeof row.user_id === 'string') return row.user_id;
	}
	return null;
}

function parsePages(value: unknown): PendingPage[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is PendingPage => {
		const row = record(item);
		return Boolean(
			row &&
				typeof row.page_id === 'string' &&
				typeof row.document_id === 'string' &&
				typeof row.document_title === 'string' &&
				typeof row.page_number === 'number' &&
				Number.isInteger(row.page_number) &&
				typeof row.source_text === 'string' &&
				typeof row.source_hash === 'string'
		);
	});
}

async function asUser(
	admin: SupabaseClient,
	userId: string,
	operation: 'list' | 'replace' | 'record_failure',
	payload: Record<string, unknown>
) {
	const { data, error } = await admin.rpc('background_semantic_as_user', {
		target_user_id: userId,
		operation,
		payload
	});
	if (error) throw error;
	const result = record(data);
	if (!result || result.ok !== true) throw new Error('background_semantic_operation_rejected');
	return result.value;
}

async function nextUser(admin: SupabaseClient) {
	const { data, error } = await admin.rpc('list_background_semantic_users', {
		target_model: SEMANTIC_EMBEDDING_MODEL,
		result_limit: 1
	});
	if (error) throw error;
	return parseUserId(data);
}

function failureStatus(error: unknown) {
	if (error instanceof GeminiEmbeddingHttpError) {
		if (error.status === 429) return 'rate_limited';
		if (error.status >= 500) return 'provider_http_error';
		return 'provider_rejected';
	}
	return 'index_error';
}

async function indexPage(input: {
	admin: SupabaseClient;
	apiKey: string;
	userId: string;
	page: PendingPage;
	signal?: AbortSignal;
}) {
	const chunks = chunkSemanticText(input.page.source_text);
	if (chunks.length === 0) return 0;
	const vectors = await requestGeminiEmbeddings({
		apiKey: input.apiKey,
		model: SEMANTIC_EMBEDDING_MODEL,
		inputs: chunks.map((chunk) => ({
			text: chunk.text,
			title: input.page.document_title
		})),
		taskType: 'RETRIEVAL_DOCUMENT',
		outputDimensionality: SEMANTIC_EMBEDDING_DIMENSIONS,
		...(input.signal ? { signal: input.signal } : {})
	});
	if (vectors.length !== chunks.length) throw new Error('semantic_embedding_count_mismatch');
	const payload = chunks.map((chunk, index) => {
		const vector = vectors[index];
		if (!vector) throw new Error('semantic_embedding_missing');
		return {
			chunk_index: chunk.index,
			chunk_text: chunk.text,
			embedding_text: embeddingVectorText(vector)
		};
	});
	const stored = await asUser(input.admin, input.userId, 'replace', {
		pageId: input.page.page_id,
		model: SEMANTIC_EMBEDDING_MODEL,
		sourceHash: input.page.source_hash,
		chunks: payload
	});
	return Math.max(0, Number(stored ?? 0));
}

export async function indexBackgroundSemanticPass(input: {
	admin: SupabaseClient;
	apiKey: string;
	batchPages?: number;
	signal?: AbortSignal;
}): Promise<BackgroundResult> {
	const userId = await nextUser(input.admin);
	if (!userId) {
		return Object.freeze({
			processedUserId: null,
			attemptedPages: 0,
			indexedPages: 0,
			failedPages: 0,
			storedChunks: 0,
			rateLimited: false,
			hasMore: false
		});
	}

	const limit = Math.max(1, Math.min(12, Math.round(input.batchPages ?? 6)));
	const listed = await asUser(input.admin, userId, 'list', {
		model: SEMANTIC_EMBEDDING_MODEL,
		limit
	});
	const pages = parsePages(listed).slice(0, limit);
	let indexedPages = 0;
	let failedPages = 0;
	let storedChunks = 0;
	let rateLimited = false;

	for (const page of pages) {
		if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		try {
			const stored = await indexPage({
				admin: input.admin,
				apiKey: input.apiKey,
				userId,
				page,
				...(input.signal ? { signal: input.signal } : {})
			});
			if (stored > 0) {
				indexedPages += 1;
				storedChunks += stored;
			} else {
				failedPages += 1;
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			failedPages += 1;
			await asUser(input.admin, userId, 'record_failure', {
				pageId: page.page_id,
				model: SEMANTIC_EMBEDDING_MODEL,
				status: failureStatus(error)
			}).catch(() => undefined);
			if (error instanceof GeminiEmbeddingHttpError && error.status === 429) {
				rateLimited = true;
				break;
			}
		}
	}

	return Object.freeze({
		processedUserId: userId,
		attemptedPages: pages.length,
		indexedPages,
		failedPages,
		storedChunks,
		rateLimited,
		hasMore: !rateLimited && (await nextUser(input.admin)) !== null
	});
}
