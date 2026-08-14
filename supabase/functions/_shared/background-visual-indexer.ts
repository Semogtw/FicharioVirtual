import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
	embeddingVectorText,
	GeminiEmbeddingHttpError,
	GeminiEmbeddingResponseError,
	GeminiEmbeddingTransportError,
	requestGeminiVisualEmbeddings
} from './gemini-embedding-client.ts';
import { SEMANTIC_EMBEDDING_DIMENSIONS, SEMANTIC_EMBEDDING_MODEL } from './semantic-config.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_BYTES = 24 * 1024 * 1024;
const MAX_ATTEMPTS = 8;

type VisualJob = Readonly<{
	jobId: string;
	userId: string;
	pageId: string;
	documentId: string;
	documentKind: 'image' | 'pdf';
	mediaPath: string;
	mimeType: 'image/jpeg' | 'image/png';
	routingVersion: 'visual-v1';
	routingReason: string;
	attemptCount: number;
	temporaryMedia: boolean;
}>;

type PreparedJob = VisualJob & Readonly<{ bytes: Uint8Array; sourceHash: string }>;

export type BackgroundVisualResult = Readonly<{
	attemptedJobs: number;
	indexedPages: number;
	failedPages: number;
	retryablePages: number;
	bytesEmbedded: number;
	rateLimited: boolean;
	hasMore: boolean;
}>;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseJobs(value: unknown): VisualJob[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = record(item);
		if (!row) return [];
		const jobId = row.job_id;
		const userId = row.user_id;
		const pageId = row.page_id;
		const documentId = row.document_id;
		const documentKind = row.document_kind;
		const mediaPath = row.media_path;
		const mimeType = row.mime_type;
		const routingVersion = row.routing_version;
		const routingReason = row.routing_reason;
		const attemptCount = row.attempt_count;
		const temporaryMedia = row.temporary_media;
		if (
			typeof jobId !== 'string' ||
			!UUID.test(jobId) ||
			typeof userId !== 'string' ||
			!UUID.test(userId) ||
			typeof pageId !== 'string' ||
			!UUID.test(pageId) ||
			typeof documentId !== 'string' ||
			!UUID.test(documentId) ||
			(documentKind !== 'image' && documentKind !== 'pdf') ||
			typeof mediaPath !== 'string' ||
			mediaPath.length < 3 ||
			mediaPath.length > 1024 ||
			(mimeType !== 'image/jpeg' && mimeType !== 'image/png') ||
			routingVersion !== 'visual-v1' ||
			typeof routingReason !== 'string' ||
			!Number.isInteger(attemptCount) ||
			Number(attemptCount) < 1 ||
			Number(attemptCount) > 100 ||
			typeof temporaryMedia !== 'boolean'
		) {
			return [];
		}
		return [
			Object.freeze({
				jobId,
				userId,
				pageId,
				documentId,
				documentKind,
				mediaPath,
				mimeType,
				routingVersion,
				routingReason,
				attemptCount: Number(attemptCount),
				temporaryMedia
			})
		];
	});
}

async function sha256Hex(bytes: Uint8Array) {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function retryAt(attemptCount: number, baseSeconds = 30) {
	const seconds = Math.min(30 * 60, baseSeconds * 2 ** Math.min(Math.max(attemptCount - 1, 0), 6));
	return new Date(Date.now() + seconds * 1000).toISOString();
}

async function recordEvent(
	admin: SupabaseClient,
	job: VisualJob,
	input: { status: string; bytes: number; durationMs: number }
) {
	await admin
		.rpc('record_semantic_visual_event_as_user', {
			target_user_id: job.userId,
			event_operation: 'index',
			event_model: SEMANTIC_EMBEDDING_MODEL,
			event_item_count: 1,
			event_overlap_count: 0,
			event_bytes_total: Math.max(0, Math.round(input.bytes)),
			event_duration_ms: Math.max(0, Math.round(input.durationMs)),
			event_status: input.status,
			event_routing_reason: job.routingReason,
			event_routing_version: job.routingVersion
		})
		.catch(() => undefined);
}

async function cleanupTemporary(admin: SupabaseClient, value: unknown) {
	const completion = record(value);
	if (
		!completion ||
		completion.temporaryMedia !== true ||
		completion.terminal === false ||
		typeof completion.pageId !== 'string' ||
		typeof completion.userId !== 'string' ||
		typeof completion.mediaPath !== 'string'
	) {
		return;
	}
	const { error: removeError } = await admin.storage
		.from('documents')
		.remove([completion.mediaPath]);
	if (removeError) return;
	await admin
		.rpc('clear_page_visual_embedding_temporary_media', {
			target_user_id: completion.userId,
			target_page_id: completion.pageId,
			expected_media_path: completion.mediaPath
		})
		.catch(() => undefined);
}

async function reuseExistingEmbedding(admin: SupabaseClient, job: PreparedJob) {
	const { data, error } = await admin.rpc('reuse_page_visual_embedding_job', {
		target_job_id: job.jobId,
		target_source_hash: job.sourceHash
	});
	if (error) return false;
	const result = record(data);
	if (result?.reused !== true) return false;
	await cleanupTemporary(admin, result);
	return true;
}

async function finishFailure(
	admin: SupabaseClient,
	job: VisualJob,
	input: { status: 'retryable' | 'blocked_quota' | 'failed'; code: string; retryAt: string | null }
) {
	const { data } = await admin.rpc('finish_page_visual_embedding_job', {
		target_job_id: job.jobId,
		terminal_status: input.status,
		safe_error_code: input.code,
		retry_at: input.retryAt
	});
	if (input.status === 'failed') await cleanupTemporary(admin, data);
}

async function prepareJob(admin: SupabaseClient, job: VisualJob): Promise<PreparedJob | null> {
	const startedAt = performance.now();
	const { data: blob, error } = await admin.storage.from('documents').download(job.mediaPath);
	if (error || !blob) {
		const terminal = job.attemptCount >= MAX_ATTEMPTS;
		await finishFailure(admin, job, {
			status: terminal ? 'failed' : 'retryable',
			code: 'visual_source_unavailable',
			retryAt: terminal ? null : retryAt(job.attemptCount, 30)
		});
		await recordEvent(admin, job, {
			status: terminal ? 'invalid_media' : 'provider_error',
			bytes: 0,
			durationMs: performance.now() - startedAt
		});
		return null;
	}
	if (blob.size < 1 || blob.size > MAX_IMAGE_BYTES) {
		await finishFailure(admin, job, {
			status: 'failed',
			code: blob.size < 1 ? 'visual_source_empty' : 'visual_source_too_large',
			retryAt: null
		});
		await recordEvent(admin, job, {
			status: 'invalid_media',
			bytes: blob.size,
			durationMs: performance.now() - startedAt
		});
		return null;
	}
	const observedMime = blob.type || job.mimeType;
	if (
		observedMime !== job.mimeType ||
		(observedMime !== 'image/jpeg' && observedMime !== 'image/png')
	) {
		await finishFailure(admin, job, {
			status: 'failed',
			code: 'visual_source_mime_mismatch',
			retryAt: null
		});
		await recordEvent(admin, job, {
			status: 'invalid_media',
			bytes: blob.size,
			durationMs: performance.now() - startedAt
		});
		return null;
	}
	const bytes = new Uint8Array(await blob.arrayBuffer());
	return Object.freeze({ ...job, bytes, sourceHash: await sha256Hex(bytes) });
}

function providerFailure(error: unknown, attemptCount: number) {
	if (error instanceof GeminiEmbeddingHttpError && error.status === 429) {
		return {
			status: 'blocked_quota' as const,
			code: 'visual_embedding_rate_limited',
			retryAt: retryAt(attemptCount, 300),
			eventStatus: 'rate_limited'
		};
	}
	const retryable =
		error instanceof GeminiEmbeddingTransportError ||
		error instanceof GeminiEmbeddingResponseError ||
		(error instanceof GeminiEmbeddingHttpError && error.status >= 500) ||
		(error instanceof DOMException && error.name === 'AbortError');
	const terminal = !retryable || attemptCount >= MAX_ATTEMPTS;
	return {
		status: terminal ? ('failed' as const) : ('retryable' as const),
		code:
			error instanceof GeminiEmbeddingHttpError && error.status < 500
				? 'visual_embedding_provider_rejected'
				: 'visual_embedding_provider_unavailable',
		retryAt: terminal ? null : retryAt(attemptCount),
		eventStatus: 'provider_error'
	};
}

export async function indexBackgroundVisualPass(input: {
	admin: SupabaseClient;
	apiKey: string;
	batchPages?: number;
	maxBatchBytes?: number;
	signal?: AbortSignal;
}): Promise<BackgroundVisualResult> {
	const limit = Math.max(1, Math.min(6, Math.round(input.batchPages ?? 4)));
	const maxBatchBytes = Math.max(
		1024 * 1024,
		Math.min(MAX_BATCH_BYTES, Math.round(input.maxBatchBytes ?? 16 * 1024 * 1024))
	);
	const { data, error } = await input.admin.rpc('claim_page_visual_embedding_jobs', {
		target_model: SEMANTIC_EMBEDDING_MODEL,
		result_limit: limit
	});
	if (error) throw error;
	const jobs = parseJobs(data).slice(0, limit);
	if (jobs.length === 0) {
		return Object.freeze({
			attemptedJobs: 0,
			indexedPages: 0,
			failedPages: 0,
			retryablePages: 0,
			bytesEmbedded: 0,
			rateLimited: false,
			hasMore: false
		});
	}

	const prepared: PreparedJob[] = [];
	let aggregateBytes = 0;
	let failedPages = 0;
	let retryablePages = 0;
	let reusedPages = 0;
	for (const job of jobs) {
		if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
		const candidate = await prepareJob(input.admin, job);
		if (!candidate) {
			if (job.attemptCount >= MAX_ATTEMPTS) failedPages += 1;
			else retryablePages += 1;
			continue;
		}
		if (await reuseExistingEmbedding(input.admin, candidate)) {
			reusedPages += 1;
			continue;
		}
		if (aggregateBytes + candidate.bytes.byteLength > maxBatchBytes) {
			await finishFailure(input.admin, job, {
				status: 'retryable',
				code: 'visual_embedding_batch_bytes_deferred',
				retryAt: retryAt(job.attemptCount, 15)
			});
			retryablePages += 1;
			continue;
		}
		aggregateBytes += candidate.bytes.byteLength;
		prepared.push(candidate);
	}

	let indexedPages = reusedPages;
	let bytesEmbedded = 0;
	let rateLimited = false;
	if (prepared.length > 0) {
		const startedAt = performance.now();
		try {
			const vectors = await requestGeminiVisualEmbeddings({
				apiKey: input.apiKey,
				model: SEMANTIC_EMBEDDING_MODEL,
				inputs: prepared.map((job) => ({ mimeType: job.mimeType, bytes: job.bytes })),
				outputDimensionality: SEMANTIC_EMBEDDING_DIMENSIONS,
				...(input.signal ? { signal: input.signal } : {})
			});
			if (vectors.length !== prepared.length) throw new GeminiEmbeddingResponseError();
			for (let index = 0; index < prepared.length; index += 1) {
				const job = prepared[index]!;
				const vector = vectors[index];
				if (!vector) throw new GeminiEmbeddingResponseError();
				const { data: completion, error: completionError } = await input.admin.rpc(
					'complete_page_visual_embedding_job',
					{
						target_job_id: job.jobId,
						target_source_hash: job.sourceHash,
						embedding_text: embeddingVectorText(vector),
						target_bytes_total: job.bytes.byteLength
					}
				);
				if (completionError) {
					await finishFailure(input.admin, job, {
						status: job.attemptCount >= MAX_ATTEMPTS ? 'failed' : 'retryable',
						code: 'visual_embedding_persistence_failed',
						retryAt: job.attemptCount >= MAX_ATTEMPTS ? null : retryAt(job.attemptCount)
					}).catch(() => undefined);
					retryablePages += 1;
					continue;
				}
				const completionRecord = record(completion);
				if (completionRecord?.stored !== true) {
					await cleanupTemporary(input.admin, completionRecord);
					failedPages += 1;
					continue;
				}
				await cleanupTemporary(input.admin, { ...completionRecord, terminal: true });
				indexedPages += 1;
				bytesEmbedded += job.bytes.byteLength;
				await recordEvent(input.admin, job, {
					status: 'success',
					bytes: job.bytes.byteLength,
					durationMs: performance.now() - startedAt
				});
			}
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError' && input.signal?.aborted) {
				// Persist retry state before propagating the worker timeout.
			}
			for (const job of prepared) {
				const failure = providerFailure(error, job.attemptCount);
				await finishFailure(input.admin, job, failure).catch(() => undefined);
				await recordEvent(input.admin, job, {
					status: failure.eventStatus,
					bytes: job.bytes.byteLength,
					durationMs: performance.now() - startedAt
				});
				if (failure.status === 'failed') failedPages += 1;
				else retryablePages += 1;
				if (failure.status === 'blocked_quota') rateLimited = true;
			}
			if (error instanceof DOMException && error.name === 'AbortError' && input.signal?.aborted) {
				throw error;
			}
		}
	}

	return Object.freeze({
		attemptedJobs: jobs.length,
		indexedPages,
		failedPages,
		retryablePages,
		bytesEmbedded,
		rateLimited,
		hasMore: !rateLimited && jobs.length === limit
	});
}
