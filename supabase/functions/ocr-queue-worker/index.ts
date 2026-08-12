import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseOcrClaimResult } from '../_shared/ocr-contract.ts';
import { planOcrFailure } from '../_shared/ocr-failure.ts';
import { requestGeminiOcrBatch, type GeminiOcrBatchPage } from '../_shared/gemini-ocr-client.ts';
import {
	DEFAULT_GEMINI_OCR_FALLBACK_MODEL,
	DEFAULT_GEMINI_OCR_MAX_QUEUE_WAIT_MS,
	DEFAULT_GEMINI_OCR_PRIMARY_MODEL,
	DEFAULT_GEMINI_OCR_RPM,
	LocalOcrProviderRateLimitError,
	parseGeminiRateReservation,
	retryAtFromRateLimit,
	shouldFallbackGeminiOcr
} from '../_shared/gemini-ocr-routing.ts';
import { buildGeminiTelemetryRpcArgs } from '../_shared/ocr-provider-telemetry.ts';
import { randomJitterMs } from '../_shared/random-jitter.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INLINE_IMAGE_BYTES = 14 * 1024 * 1024;
const WORKER_MODE_HEADER = 'X-Fichario-Worker-Mode';

type Candidate = Readonly<{
	userId: string;
	jobId: string;
	pageId: string;
	documentId: string;
	pageNumber: number;
	attemptCount: number;
	batchId: string | null;
	temporaryImagePath: string | null;
	documentKind: 'image' | 'pdf';
	documentStoragePath: string | null;
}>;

type ClaimedCandidate = Readonly<{
	candidate: Candidate;
	attemptCount: number;
}>;

type WorkerConfig = Readonly<{
	supabaseUrl: string;
	serviceRoleKey: string;
	workerKey: string;
	apiKey: string;
	primaryModel: string;
	fallbackModel: string;
	promptVersion: number;
	primaryRpm: number;
	fallbackRpm: number;
	maxQueueWaitMs: number;
	maxPages: number;
	maxBytes: number;
	requestTimeoutMs: number;
}>;

function response(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function config(): WorkerConfig | null {
	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const workerKey = Deno.env.get('OCR_BACKGROUND_WORKER_KEY');
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const primaryModel = Deno.env.get('OCR_MODEL_PRIMARY') ?? DEFAULT_GEMINI_OCR_PRIMARY_MODEL;
	const fallbackModel = Deno.env.get('OCR_MODEL_FALLBACK') ?? DEFAULT_GEMINI_OCR_FALLBACK_MODEL;
	const promptVersion = Number(Deno.env.get('OCR_PROMPT_VERSION') ?? '1');
	const primaryRpm = envInteger('OCR_MODEL_PRIMARY_RPM', DEFAULT_GEMINI_OCR_RPM, 1, 60);
	const fallbackRpm = envInteger('OCR_MODEL_FALLBACK_RPM', DEFAULT_GEMINI_OCR_RPM, 1, 60);
	const maxQueueWaitMs = envInteger(
		'OCR_PROVIDER_MAX_QUEUE_WAIT_MS',
		DEFAULT_GEMINI_OCR_MAX_QUEUE_WAIT_MS,
		0,
		60_000
	);
	const maxPages = envInteger('OCR_BACKGROUND_MAX_PAGES', 8, 1, 20);
	const maxBytes = envInteger(
		'OCR_BACKGROUND_MAX_BYTES',
		8 * 1024 * 1024,
		1024 * 1024,
		12 * 1024 * 1024
	);
	const requestTimeoutMs = envInteger('OCR_BACKGROUND_TIMEOUT_MS', 90_000, 10_000, 120_000);
	if (
		!supabaseUrl ||
		!serviceRoleKey ||
		!workerKey ||
		!apiKey ||
		!MODEL.test(primaryModel) ||
		!MODEL.test(fallbackModel) ||
		primaryModel === fallbackModel ||
		!Number.isInteger(promptVersion) ||
		promptVersion < 1 ||
		promptVersion > 10_000 ||
		primaryRpm === null ||
		fallbackRpm === null ||
		maxQueueWaitMs === null ||
		maxPages === null ||
		maxBytes === null ||
		requestTimeoutMs === null
	) {
		return null;
	}
	return Object.freeze({
		supabaseUrl,
		serviceRoleKey,
		workerKey,
		apiKey,
		primaryModel,
		fallbackModel,
		promptVersion,
		primaryRpm,
		fallbackRpm,
		maxQueueWaitMs,
		maxPages,
		maxBytes,
		requestTimeoutMs
	});
}

async function sha256(value: string) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function secretMatches(presented: string | null, expected: string) {
	if (!presented || presented.length !== expected.length) return false;
	const [left, right] = await Promise.all([sha256(presented), sha256(expected)]);
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
	return difference === 0;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseCandidate(value: unknown): Candidate | null {
	const row = record(value);
	if (!row) return null;
	const userId = row.user_id;
	const jobId = row.job_id;
	const pageId = row.page_id;
	const documentId = row.document_id;
	const pageNumber = row.page_number;
	const attemptCount = row.attempt_count;
	const batchId = row.batch_id;
	const temporaryImagePath = row.temporary_image_path;
	const documentKind = row.document_kind;
	const documentStoragePath = row.document_storage_path;
	if (
		typeof userId !== 'string' ||
		!UUID.test(userId) ||
		typeof jobId !== 'string' ||
		!UUID.test(jobId) ||
		typeof pageId !== 'string' ||
		!UUID.test(pageId) ||
		typeof documentId !== 'string' ||
		!UUID.test(documentId) ||
		typeof pageNumber !== 'number' ||
		!Number.isInteger(pageNumber) ||
		pageNumber < 1 ||
		typeof attemptCount !== 'number' ||
		!Number.isInteger(attemptCount) ||
		attemptCount < 0 ||
		(batchId !== null && (typeof batchId !== 'string' || !UUID.test(batchId))) ||
		(temporaryImagePath !== null &&
			(typeof temporaryImagePath !== 'string' || temporaryImagePath.length < 1)) ||
		(documentKind !== 'image' && documentKind !== 'pdf') ||
		(documentStoragePath !== null && typeof documentStoragePath !== 'string')
	) {
		return null;
	}
	return Object.freeze({
		userId,
		jobId,
		pageId,
		documentId,
		pageNumber,
		attemptCount,
		batchId: batchId as string | null,
		temporaryImagePath: temporaryImagePath as string | null,
		documentKind,
		documentStoragePath: documentStoragePath as string | null
	});
}

function retryAt(attemptCount: number, baseSeconds: number) {
	const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
	const delayMs = Math.min(60 * 60 * 1000, baseSeconds * 1000 * 2 ** exponent + randomJitterMs());
	return new Date(Date.now() + delayMs).toISOString();
}

async function runAsUser(
	admin: ReturnType<typeof createClient>,
	userId: string,
	operation: string,
	payload: Record<string, unknown>
) {
	const { data, error } = await admin.rpc('background_ocr_as_user', {
		target_user_id: userId,
		operation,
		payload
	});
	if (error) throw new Error(`Background OCR operation failed: ${operation}`);
	const result = record(data);
	if (!result || result.ok !== true) {
		throw new Error(`Background OCR operation rejected: ${operation}`);
	}
	return result.value;
}

async function failClaim(
	admin: ReturnType<typeof createClient>,
	claimed: ClaimedCandidate,
	failure: {
		code: string;
		message: string;
		retryable: boolean;
		failedAt: string;
		nextRetryAt: string | null;
	}
) {
	await runAsUser(admin, claimed.candidate.userId, 'fail', {
		pageId: claimed.candidate.pageId,
		code: failure.code,
		message: failure.message,
		retryable: failure.retryable,
		failedAt: failure.failedAt,
		retryAt: failure.nextRetryAt
	});
}

async function cleanupTemporaryImage(
	admin: ReturnType<typeof createClient>,
	claimed: ClaimedCandidate
) {
	const path = claimed.candidate.temporaryImagePath;
	if (!path) return;
	const { error } = await admin.storage.from('documents').remove([path]);
	if (error) return;
	await runAsUser(admin, claimed.candidate.userId, 'clear_temporary_image', {
		pageId: claimed.candidate.pageId,
		path
	}).catch(() => undefined);
}

async function candidates(admin: ReturnType<typeof createClient>, limit: number) {
	await admin.rpc('recover_background_stale_ocr_jobs');
	const { data, error } = await admin.rpc('list_background_gemini_ocr_candidates', {
		result_limit: limit
	});
	if (error || !Array.isArray(data)) throw new Error('Background OCR candidate lookup failed');
	const parsed = data.map(parseCandidate).filter((value): value is Candidate => value !== null);
	if (parsed.length !== data.length) throw new Error('Invalid background OCR candidate response');
	return parsed;
}

async function reconcile(admin: ReturnType<typeof createClient>, batchIds: readonly string[]) {
	if (batchIds.length === 0) return;
	await admin.rpc('reconcile_background_ocr_batches', {
		target_batch_ids: [...new Set(batchIds)],
		reconciled_at: new Date().toISOString()
	});
}

async function reserveProviderSlot(
	admin: ReturnType<typeof createClient>,
	model: string,
	rpm: number,
	maxQueueWaitMs: number
) {
	const { data, error } = await admin.rpc('reserve_ocr_provider_rate_slot', {
		target_model: model,
		target_rpm: rpm,
		max_wait_ms: maxQueueWaitMs
	});
	const reservation = error ? null : parseGeminiRateReservation(data);
	if (!reservation) {
		throw new LocalOcrProviderRateLimitError('rate_limiter_unavailable', 5_000);
	}
	if (!reservation.allowed) {
		throw new LocalOcrProviderRateLimitError('local_queue_full', reservation.waitMs || 5_000);
	}
	if (reservation.waitMs > 0) {
		await new Promise<void>((resolve) => setTimeout(resolve, reservation.waitMs));
	}
}

async function drainOnce(settings: WorkerConfig) {
	const admin = createClient(settings.supabaseUrl, settings.serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const available = await candidates(admin, Math.min(100, settings.maxPages * 4));
	const first = available[0];
	if (!first) return false;

	const selected = available
		.filter(
			(candidate) =>
				candidate.userId === first.userId &&
				candidate.documentId === first.documentId &&
				candidate.batchId === first.batchId
		)
		.slice(0, settings.maxPages);
	const claimed: ClaimedCandidate[] = [];
	const batchIds = selected.flatMap((candidate) => (candidate.batchId ? [candidate.batchId] : []));

	for (const candidate of selected) {
		const value = await runAsUser(admin, candidate.userId, 'claim', {
			pageId: candidate.pageId,
			model: settings.primaryModel,
			claimedAt: new Date().toISOString()
		});
		const claim = parseOcrClaimResult(value);
		if (!claim) throw new Error('Invalid background OCR claim response');
		if (claim.state === 'claimed') {
			claimed.push(Object.freeze({ candidate, attemptCount: claim.attemptCount }));
		}
	}

	if (claimed.length === 0) {
		await reconcile(admin, batchIds);
		return (await candidates(admin, 1)).length > 0;
	}

	const providerPages: GeminiOcrBatchPage[] = [];
	const providerClaims = new Map<string, ClaimedCandidate>();
	let aggregateBytes = 0;
	for (const entry of claimed) {
		const sourcePath =
			entry.candidate.temporaryImagePath ??
			(entry.candidate.documentKind === 'image' ? entry.candidate.documentStoragePath : null);
		if (!sourcePath || sourcePath.startsWith('drive:')) {
			await failClaim(admin, entry, {
				code: 'ocr_source_missing',
				message: 'A página ainda não foi preparada para leitura.',
				retryable: false,
				failedAt: new Date().toISOString(),
				nextRetryAt: null
			});
			continue;
		}
		const { data: blob, error } = await admin.storage.from('documents').download(sourcePath);
		if (error || !blob) {
			await failClaim(admin, entry, {
				code: 'ocr_source_unavailable',
				message: 'A página não pôde ser carregada do armazenamento.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(entry.attemptCount, 30)
			});
			continue;
		}
		if (blob.size < 1 || blob.size > MAX_INLINE_IMAGE_BYTES) {
			await failClaim(admin, entry, {
				code: 'ocr_source_too_large',
				message: 'A imagem da página excede o limite seguro do OCR.',
				retryable: false,
				failedAt: new Date().toISOString(),
				nextRetryAt: null
			});
			continue;
		}
		if (providerPages.length > 0 && aggregateBytes + blob.size > settings.maxBytes) {
			await failClaim(admin, entry, {
				code: 'ocr_batch_too_large',
				message: 'O lote excedeu o limite de bytes e será continuado separadamente.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(entry.attemptCount, 5)
			});
			continue;
		}
		const bytes = new Uint8Array(await blob.arrayBuffer());
		aggregateBytes += bytes.byteLength;
		providerPages.push({
			pageId: entry.candidate.pageId,
			pageNumber: entry.candidate.pageNumber,
			mimeType: blob.type || 'image/webp',
			bytes
		});
		providerClaims.set(entry.candidate.pageId, entry);
	}

	if (providerPages.length === 0) {
		await reconcile(admin, batchIds);
		return (await candidates(admin, 1)).length > 0;
	}

	if (first.batchId) {
		await runAsUser(admin, first.userId, 'record_batch_call', {
			batchId: first.batchId,
			attemptedPages: providerPages.length,
			calledAt: new Date().toISOString()
		}).catch(() => undefined);
	}

	const attemptProvider = async (model: string, rpm: number) => {
		await reserveProviderSlot(admin, model, rpm, settings.maxQueueWaitMs);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutMs);
		const startedAt = performance.now();
		try {
			const outcome = await requestGeminiOcrBatch({
				apiKey: settings.apiKey,
				model,
				promptVersion: settings.promptVersion,
				pages: providerPages,
				signal: controller.signal
			});
			return Object.freeze({
				ok: true as const,
				outcome,
				latencyMs: performance.now() - startedAt
			});
		} catch (error) {
			return Object.freeze({ ok: false as const, error, latencyMs: performance.now() - startedAt });
		} finally {
			clearTimeout(timeout);
		}
	};

	let activeModel = settings.primaryModel;
	let routeReason = 'primary_gemini';
	let eventId = crypto.randomUUID();
	let latencyMs = 0;
	try {
		let attempt = await attemptProvider(settings.primaryModel, settings.primaryRpm);
		latencyMs = attempt.latencyMs;
		if (!attempt.ok && shouldFallbackGeminiOcr(attempt.error)) {
			const firstClaim = providerClaims.get(providerPages[0]!.pageId)!;
			const primaryDecision = planOcrFailure(attempt.error, {
				attemptCount: firstClaim.attemptCount,
				failedAt: new Date(),
				jitterMs: 0
			});
			await runAsUser(admin, first.userId, 'record_provider_usage', {
				args: buildGeminiTelemetryRpcArgs({
					eventId,
					documentId: first.documentId,
					batchId: first.batchId,
					model: settings.primaryModel,
					promptVersion: settings.promptVersion,
					documentKind: first.documentKind,
					pages: providerPages,
					outcome: null,
					status: 'error',
					safeErrorCode: primaryDecision.persistence.code,
					latencyMs,
					recordedAt: new Date().toISOString(),
					routeReason: 'primary_gemini'
				})
			}).catch(() => undefined);
			activeModel = settings.fallbackModel;
			routeReason = 'fallback_gemini_rate_limit';
			eventId = crypto.randomUUID();
			attempt = await attemptProvider(settings.fallbackModel, settings.fallbackRpm);
			latencyMs = attempt.latencyMs;
		}
		if (!attempt.ok) throw attempt.error;
		const outcome = attempt.outcome;

		await runAsUser(admin, first.userId, 'record_provider_usage', {
			args: buildGeminiTelemetryRpcArgs({
				eventId,
				documentId: first.documentId,
				batchId: first.batchId,
				model: activeModel,
				promptVersion: settings.promptVersion,
				documentKind: first.documentKind,
				pages: providerPages,
				outcome,
				status: 'success',
				safeErrorCode: null,
				latencyMs,
				recordedAt: new Date().toISOString(),
				routeReason
			})
		}).catch(() => undefined);

		const completedIds = new Set<string>();
		for (const result of outcome.pages) {
			const entry = providerClaims.get(result.pageId);
			if (!entry) continue;
			completedIds.add(result.pageId);
			try {
				await runAsUser(admin, entry.candidate.userId, 'complete_geometry', {
					pageId: result.pageId,
					text: result.text,
					warnings: result.warnings,
					status: result.needsReview ? 'needs_review' : 'ready',
					completedAt: new Date().toISOString(),
					geometry: result.wordGeometry
				});
				await cleanupTemporaryImage(admin, entry);
			} catch {
				await failClaim(admin, entry, {
					code: 'ocr_persistence_failed',
					message: 'O resultado não pôde ser salvo com segurança.',
					retryable: true,
					failedAt: new Date().toISOString(),
					nextRetryAt: retryAt(entry.attemptCount, 15)
				}).catch(() => undefined);
			}
		}

		const splitIds = new Set([
			...outcome.missingPageIds,
			...outcome.duplicatePageIds,
			...providerPages.map((page) => page.pageId).filter((pageId) => !completedIds.has(pageId))
		]);
		for (const pageId of splitIds) {
			const entry = providerClaims.get(pageId);
			if (!entry || completedIds.has(pageId)) continue;
			await failClaim(admin, entry, {
				code: 'ocr_batch_response_incomplete',
				message: 'O lote retornou uma página ausente ou ambígua e será dividido.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(entry.attemptCount, 5)
			}).catch(() => undefined);
		}
	} catch (error) {
		if (error instanceof LocalOcrProviderRateLimitError) {
			const failedAt = new Date();
			const nextRetryAt = retryAtFromRateLimit(failedAt, error.retryAfterMs);
			const code =
				error.reason === 'local_queue_full'
					? 'ocr_provider_rate_queue_full'
					: 'ocr_rate_limiter_unavailable';
			const message =
				error.reason === 'local_queue_full'
					? 'O OCR está aguardando uma vaga segura no limite de requisições do provedor.'
					: 'O limitador compartilhado de requisições do OCR está temporariamente indisponível.';
			for (const page of providerPages) {
				const entry = providerClaims.get(page.pageId)!;
				await failClaim(admin, entry, {
					code,
					message,
					retryable: true,
					failedAt: failedAt.toISOString(),
					nextRetryAt
				}).catch(() => undefined);
			}
		} else {
			let telemetryCode = 'ocr_request_failed';
			for (const page of providerPages) {
				const entry = providerClaims.get(page.pageId)!;
				const decision = planOcrFailure(error, {
					attemptCount: entry.attemptCount,
					failedAt: new Date(),
					jitterMs: 0
				});
				telemetryCode = decision.persistence.code;
				if (decision.persistence.kind === 'block_quota') {
					await runAsUser(admin, entry.candidate.userId, 'block_quota', {
						pageId: page.pageId,
						code: decision.persistence.code,
						blockedAt: decision.persistence.failedAt
					}).catch(() => undefined);
				} else {
					await failClaim(admin, entry, decision.persistence).catch(() => undefined);
				}
			}
			await runAsUser(admin, first.userId, 'record_provider_usage', {
				args: buildGeminiTelemetryRpcArgs({
					eventId,
					documentId: first.documentId,
					batchId: first.batchId,
					model: activeModel,
					promptVersion: settings.promptVersion,
					documentKind: first.documentKind,
					pages: providerPages,
					outcome: null,
					status: 'error',
					safeErrorCode: telemetryCode,
					latencyMs,
					recordedAt: new Date().toISOString(),
					routeReason
				})
			}).catch(() => undefined);
		}
	} finally {
		await reconcile(admin, batchIds);
	}

	return (await candidates(admin, 1)).length > 0;
}

function workerFailureCode(error: unknown) {
	if (!(error instanceof Error)) return 'unknown';
	if (error.message === 'Background OCR candidate lookup failed') return 'candidate_lookup_failed';
	if (error.message === 'Invalid background OCR candidate response')
		return 'candidate_response_invalid';
	if (error.message === 'Invalid background OCR claim response') return 'claim_response_invalid';
	if (error.message.startsWith('Background OCR operation failed: ')) return 'operation_failed';
	if (error.message.startsWith('Background OCR operation rejected: ')) return 'operation_rejected';
	return 'execution_failed';
}

function reportWorkerFailure(error: unknown) {
	const failure = workerFailureCode(error);
	console.error(`ocr_background_worker_failed:${failure}`);
	return failure;
}

async function runAndChain(settings: WorkerConfig) {
	try {
		const hasMore = await drainOnce(settings);
		if (!hasMore) return;
		const chained = await fetch(`${settings.supabaseUrl}/functions/v1/ocr-queue-worker`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Fichario-Worker-Key': settings.workerKey
			},
			body: JSON.stringify({ source: 'chain' })
		});
		if (!chained.ok) throw new Error('Background OCR chain request failed');
	} catch (error) {
		reportWorkerFailure(error);
	}
}

Deno.serve(async (request) => {
	if (request.method !== 'POST') return response(405, { code: 'method_not_allowed' });
	const settings = config();
	if (!settings) return response(503, { code: 'ocr_background_not_configured' });
	if (!(await secretMatches(request.headers.get('X-Fichario-Worker-Key'), settings.workerKey))) {
		return response(401, { code: 'worker_authentication_required' });
	}

	const mode = request.headers.get(WORKER_MODE_HEADER);
	if (mode === 'sync') {
		try {
			const hasMore = await drainOnce(settings);
			return response(200, { completed: true, hasMore });
		} catch (error) {
			return response(500, {
				code: 'ocr_background_execution_failed',
				failure: reportWorkerFailure(error)
			});
		}
	}
	if (mode !== null) return response(400, { code: 'invalid_worker_mode' });

	EdgeRuntime.waitUntil(runAndChain(settings));
	return response(202, { accepted: true });
});
