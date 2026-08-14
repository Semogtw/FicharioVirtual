import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { claimStateHttpStatus, parseOcrClaimResult } from '../_shared/ocr-contract.ts';
import { planOcrFailure } from '../_shared/ocr-failure.ts';
import { randomJitterMs } from '../_shared/random-jitter.ts';
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
import { requestGeminiOcrBatch, type GeminiOcrBatchPage } from '../_shared/gemini-ocr-client.ts';
import { buildGeminiTelemetryRpcArgs } from '../_shared/ocr-provider-telemetry.ts';
import {
	enqueueVisualEmbeddingAfterOcr,
	visualTemporaryMediaIsNeeded
} from '../_shared/visual-embedding-enqueue.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const MAX_INLINE_IMAGE_BYTES = 14 * 1024 * 1024;
const ABSOLUTE_MAX_BATCH_PAGES = 100;
const ABSOLUTE_MAX_BATCH_BYTES = 14 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

type ParsedRequest = {
	pageIds: readonly string[];
	batchId: string | null;
};

type PageRow = {
	id: string;
	status: string;
	temporary_image_path: string | null;
	document_id: string;
	page_number: number;
	ocr_raw_text: string | null;
	corrected_text: string | null;
};

type ClaimedPage = {
	page: PageRow;
	attemptCount: number;
};

function json(status: number, body: Record<string, unknown>, appOrigin: string | null) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(appOrigin),
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
}

function empty(status: number, appOrigin: string | null) {
	return new Response(null, {
		status,
		headers: { ...corsHeaders(appOrigin), 'Cache-Control': 'no-store' }
	});
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseRequestBody(body: unknown): ParsedRequest | null {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
	const record = body as Record<string, unknown>;
	if (!hasExactKeys(record, ['pageIds']) && !hasExactKeys(record, ['batchId', 'pageIds'])) {
		return null;
	}
	if (
		!Array.isArray(record.pageIds) ||
		record.pageIds.length < 1 ||
		record.pageIds.length > ABSOLUTE_MAX_BATCH_PAGES ||
		record.pageIds.some((value) => typeof value !== 'string' || !UUID.test(value)) ||
		new Set(record.pageIds).size !== record.pageIds.length ||
		(record.batchId !== undefined &&
			(typeof record.batchId !== 'string' || !UUID.test(record.batchId)))
	) {
		return null;
	}
	return Object.freeze({
		pageIds: Object.freeze([...(record.pageIds as string[])]),
		batchId: typeof record.batchId === 'string' ? record.batchId : null
	});
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function retryAt(attemptCount: number, baseSeconds: number) {
	const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
	const jitter = randomJitterMs();
	const delayMs = Math.min(60 * 60 * 1000, baseSeconds * 1000 * 2 ** exponent + jitter);
	return new Date(Date.now() + delayMs).toISOString();
}

function aggregateBody(input: {
	completedPageIds: readonly string[];
	reviewPageIds: readonly string[];
	pendingPageIds: readonly string[];
	failedPageIds: readonly string[];
	splitRequiredPageIds: readonly string[];
	unexpectedResultPageIds?: readonly string[];
}) {
	return Object.freeze({
		state:
			input.pendingPageIds.length === 0 && input.failedPageIds.length === 0
				? 'complete'
				: 'partial',
		completedPageIds: Object.freeze([...new Set(input.completedPageIds)]),
		reviewPageIds: Object.freeze([...new Set(input.reviewPageIds)]),
		pendingPageIds: Object.freeze([...new Set(input.pendingPageIds)]),
		failedPageIds: Object.freeze([...new Set(input.failedPageIds)]),
		splitRequiredPageIds: Object.freeze([...new Set(input.splitRequiredPageIds)]),
		unexpectedResultPageIds: Object.freeze([...new Set(input.unexpectedResultPageIds ?? [])])
	});
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(
		Deno.env.get('APP_ORIGIN_ALLOWLIST') ?? Deno.env.get('APP_ORIGIN'),
		request.headers.get('Origin')
	);
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);

	if (!appOrigin) return respond(503, { code: 'ocr_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) {
		return respond(401, { code: 'authentication_required' });
	}

	let rawBody: unknown;
	try {
		rawBody = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
	} catch (error) {
		return error instanceof RequestBodyTooLargeError
			? respond(413, { code: 'ocr_request_too_large' })
			: respond(400, { code: 'invalid_json' });
	}
	const parsedRequest = parseRequestBody(rawBody);
	if (!parsedRequest) return respond(400, { code: 'invalid_ocr_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const model = Deno.env.get('OCR_MODEL_PRIMARY') ?? DEFAULT_GEMINI_OCR_PRIMARY_MODEL;
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
	const maxBatchPages = envInteger('OCR_BATCH_MAX_PAGES', 40, 1, ABSOLUTE_MAX_BATCH_PAGES);
	const maxBatchBytes = envInteger(
		'OCR_BATCH_MAX_BYTES',
		12 * 1024 * 1024,
		1024 * 1024,
		ABSOLUTE_MAX_BATCH_BYTES
	);
	const requestTimeoutMs = envInteger('OCR_REQUEST_TIMEOUT_MS', 120_000, 10_000, 140_000);
	if (
		!supabaseUrl ||
		!publishableKey ||
		!serviceRoleKey ||
		!apiKey ||
		!MODEL.test(model) ||
		!MODEL.test(fallbackModel) ||
		model === fallbackModel ||
		!Number.isInteger(promptVersion) ||
		promptVersion < 1 ||
		promptVersion > 10_000 ||
		primaryRpm === null ||
		fallbackRpm === null ||
		maxQueueWaitMs === null ||
		maxBatchPages === null ||
		maxBatchBytes === null ||
		requestTimeoutMs === null
	) {
		return respond(503, { code: 'ocr_not_configured' });
	}
	if (parsedRequest.pageIds.length > maxBatchPages) {
		return respond(413, { code: 'ocr_batch_too_many_pages', splitRequired: true });
	}

	const supabase = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user) return respond(401, { code: 'authentication_required' });

	const admin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false }
	});

	const failJob = async (
		pageId: string,
		failure: {
			code: string;
			message: string;
			retryable: boolean;
			failedAt: string;
			nextRetryAt: string | null;
		}
	) => {
		const { data, error } = await supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: failure.code,
			safe_error_message: failure.message,
			retryable: failure.retryable,
			failed_at: failure.failedAt,
			retry_at: failure.nextRetryAt
		});
		return !error && data === true;
	};

	const blockQuota = async (pageId: string, code: string, blockedAt: string) => {
		const { data, error } = await supabase.rpc('block_ocr_job_quota', {
			target_page_id: pageId,
			error_code: code,
			blocked_at: blockedAt
		});
		return !error && data === true;
	};

	const cleanupTemporaryImage = async (pageId: string, path: string | null) => {
		if (!path) return;
		if (await visualTemporaryMediaIsNeeded({ supabase, pageId, mediaPath: path })) return;
		const { error } = await supabase.storage.from('documents').remove([path]);
		if (!error) {
			await supabase.rpc('clear_temporary_page_image', {
				target_page_id: pageId,
				expected_storage_path: path
			});
		}
	};

	const finishBatch = async (
		batchId: string | null,
		status: 'ready' | 'retryable' | 'blocked_quota' | 'failed',
		code: string | null,
		message: string | null,
		nextRetryAt: string | null
	) => {
		if (!batchId) return true;
		const { data, error } = await supabase.rpc('finish_ocr_batch', {
			target_batch_id: batchId,
			terminal_status: status,
			error_code: code,
			safe_error_message: message,
			retry_at: nextRetryAt,
			finished_at: new Date().toISOString()
		});
		return !error && data === true;
	};

	const reserveProviderSlot = async (targetModel: string, rpm: number) => {
		const { data, error } = await admin.rpc('reserve_ocr_provider_rate_slot', {
			target_model: targetModel,
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
	};

	const { data: pageData, error: pageError } = await supabase
		.from('pages')
		.select('id,status,temporary_image_path,document_id,page_number,ocr_raw_text,corrected_text')
		.in('id', [...parsedRequest.pageIds]);
	if (pageError) return respond(503, { code: 'page_lookup_failed' });
	if (!Array.isArray(pageData) || pageData.length !== parsedRequest.pageIds.length) {
		return respond(404, { code: 'page_not_found' });
	}
	const pages = (pageData as PageRow[]).sort((left, right) => left.page_number - right.page_number);
	if (new Set(pages.map((page) => page.document_id)).size !== 1) {
		return respond(400, { code: 'ocr_batch_mixed_documents' });
	}
	const documentId = pages[0]!.document_id;

	if (parsedRequest.batchId) {
		const { data: registeredBatch, error: batchError } = await supabase
			.from('ocr_batches')
			.select('id,document_id,page_ids')
			.eq('id', parsedRequest.batchId)
			.maybeSingle();
		if (batchError) return respond(503, { code: 'ocr_batch_lookup_failed' });
		if (!registeredBatch) return respond(404, { code: 'ocr_batch_not_found' });
		const registeredIds = new Set(
			Array.isArray(registeredBatch.page_ids) ? registeredBatch.page_ids : []
		);
		if (
			registeredBatch.document_id !== documentId ||
			parsedRequest.pageIds.some((pageId) => !registeredIds.has(pageId))
		) {
			return respond(409, { code: 'ocr_batch_manifest_mismatch' });
		}
	}

	const completedPageIds: string[] = [];
	const reviewPageIds: string[] = [];
	const pendingPageIds: string[] = [];
	const failedPageIds: string[] = [];
	const splitRequiredPageIds: string[] = [];
	const claimedPages: ClaimedPage[] = [];
	const claimedAt = new Date().toISOString();

	for (const page of pages) {
		if (
			['ready', 'needs_review'].includes(page.status) &&
			(typeof page.corrected_text === 'string' || typeof page.ocr_raw_text === 'string')
		) {
			completedPageIds.push(page.id);
			if (page.status === 'needs_review') reviewPageIds.push(page.id);
			await cleanupTemporaryImage(page.id, page.temporary_image_path);
			continue;
		}

		const { data: claim, error: claimError } = await supabase.rpc('claim_ocr_job', {
			target_page_id: page.id,
			target_model: model,
			claimed_at: claimedAt
		});
		const claimResult =
			!claimError && claim && typeof claim === 'object' ? parseOcrClaimResult(claim) : null;
		if (!claimResult) {
			for (const claimed of claimedPages) {
				await failJob(claimed.page.id, {
					code: 'ocr_batch_claim_failed',
					message: 'O lote não pôde ser reivindicado integralmente.',
					retryable: true,
					failedAt: new Date().toISOString(),
					nextRetryAt: retryAt(claimed.attemptCount, 5)
				});
			}
			return respond(503, { code: 'ocr_claim_failed' });
		}

		if (claimResult.state === 'claimed') {
			claimedPages.push({ page, attemptCount: claimResult.attemptCount });
			continue;
		}
		if (claimResult.state === 'already_complete') {
			const { data: completedPage, error: completedPageError } = await supabase
				.from('pages')
				.select('status')
				.eq('id', page.id)
				.maybeSingle();
			if (
				completedPageError ||
				!completedPage ||
				!['ready', 'needs_review'].includes(completedPage.status)
			) {
				return respond(503, { code: 'ocr_claim_failed' });
			}
			completedPageIds.push(page.id);
			if (completedPage.status === 'needs_review') reviewPageIds.push(page.id);
			await cleanupTemporaryImage(page.id, page.temporary_image_path);
			continue;
		}
		if (
			claimResult.state === 'busy' ||
			claimResult.state === 'retry_later' ||
			claimResult.state === 'quota_exhausted'
		) {
			pendingPageIds.push(page.id);
			continue;
		}
		if (claimResult.state === 'not_retryable') {
			failedPageIds.push(page.id);
			continue;
		}

		for (const claimed of claimedPages) {
			await failJob(claimed.page.id, {
				code: 'ocr_batch_claim_aborted',
				message: 'O lote foi liberado após uma rejeição de autorização ou configuração.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(claimed.attemptCount, 5)
			});
		}
		return respond(claimStateHttpStatus(claimResult.state), { state: claimResult.state });
	}

	if (claimedPages.length === 0) {
		const result = aggregateBody({
			completedPageIds,
			reviewPageIds,
			pendingPageIds,
			failedPageIds,
			splitRequiredPageIds
		});
		return respond(pendingPageIds.length > 0 ? 202 : 200, result);
	}

	const { data: document, error: documentError } = await supabase
		.from('documents')
		.select('kind,storage_path')
		.eq('id', documentId)
		.maybeSingle();
	if (documentError || !document) {
		for (const claimed of claimedPages) {
			await failJob(claimed.page.id, {
				code: 'ocr_source_missing',
				message: 'O arquivo original não está disponível.',
				retryable: false,
				failedAt: new Date().toISOString(),
				nextRetryAt: null
			});
			failedPageIds.push(claimed.page.id);
		}
		return respond(409, { code: 'ocr_source_missing' });
	}

	const providerPages: GeminiOcrBatchPage[] = [];
	const providerClaims = new Map<string, ClaimedPage>();
	const providerSources = new Map<string, { mediaPath: string; mimeType: string }>();
	let aggregateBytes = 0;
	for (let index = 0; index < claimedPages.length; index += 1) {
		const claimed = claimedPages[index]!;
		const sourcePath =
			claimed.page.temporary_image_path ??
			(document.kind === 'image' ? document.storage_path : null);
		if (!sourcePath) {
			await failJob(claimed.page.id, {
				code: 'ocr_source_missing',
				message: 'A página ainda não foi preparada para leitura.',
				retryable: false,
				failedAt: new Date().toISOString(),
				nextRetryAt: null
			});
			failedPageIds.push(claimed.page.id);
			continue;
		}

		const { data: sourceBlob, error: sourceError } = await supabase.storage
			.from('documents')
			.download(sourcePath);
		if (sourceError || !sourceBlob) {
			await failJob(claimed.page.id, {
				code: 'ocr_source_unavailable',
				message: 'A página não pôde ser carregada do armazenamento.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(claimed.attemptCount, 30)
			});
			pendingPageIds.push(claimed.page.id);
			continue;
		}
		if (sourceBlob.size > MAX_INLINE_IMAGE_BYTES || sourceBlob.size > maxBatchBytes) {
			await failJob(claimed.page.id, {
				code: 'ocr_source_too_large',
				message: 'A imagem da página excede o limite seguro do OCR.',
				retryable: false,
				failedAt: new Date().toISOString(),
				nextRetryAt: null
			});
			failedPageIds.push(claimed.page.id);
			splitRequiredPageIds.push(claimed.page.id);
			continue;
		}
		if (aggregateBytes + sourceBlob.size > maxBatchBytes) {
			for (let pendingIndex = index; pendingIndex < claimedPages.length; pendingIndex += 1) {
				const pendingClaim = claimedPages[pendingIndex]!;
				await failJob(pendingClaim.page.id, {
					code: 'ocr_batch_too_large',
					message: 'O lote excedeu o limite de bytes e precisa ser dividido.',
					retryable: true,
					failedAt: new Date().toISOString(),
					nextRetryAt: retryAt(pendingClaim.attemptCount, 5)
				});
				pendingPageIds.push(pendingClaim.page.id);
				splitRequiredPageIds.push(pendingClaim.page.id);
			}
			break;
		}

		const bytes = new Uint8Array(await sourceBlob.arrayBuffer());
		aggregateBytes += bytes.byteLength;
		providerPages.push({
			pageId: claimed.page.id,
			pageNumber: claimed.page.page_number,
			mimeType: sourceBlob.type || 'image/webp',
			bytes
		});
		providerClaims.set(claimed.page.id, claimed);
		providerSources.set(claimed.page.id, {
			mediaPath: sourcePath,
			mimeType: sourceBlob.type || ''
		});
	}

	if (providerPages.length === 0) {
		const result = aggregateBody({
			completedPageIds,
			reviewPageIds,
			pendingPageIds,
			failedPageIds,
			splitRequiredPageIds
		});
		return respond(pendingPageIds.length > 0 ? 202 : 200, result);
	}

	const attemptProvider = async (targetModel: string, rpm: number) => {
		await reserveProviderSlot(targetModel, rpm);
		const abortController = new AbortController();
		const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);
		const startedAt = performance.now();
		try {
			const outcome = await requestGeminiOcrBatch({
				apiKey,
				model: targetModel,
				promptVersion,
				pages: providerPages,
				signal: abortController.signal
			});
			return Object.freeze({
				ok: true as const,
				outcome,
				latencyMs: performance.now() - startedAt
			});
		} catch (error) {
			return Object.freeze({
				ok: false as const,
				error,
				latencyMs: performance.now() - startedAt
			});
		} finally {
			clearTimeout(timeout);
		}
	};

	let activeModel = model;
	let activeRouteReason = 'primary_gemini';
	let telemetryEventId = crypto.randomUUID();
	let providerLatencyMs = 0;
	try {
		let attempt = await attemptProvider(model, primaryRpm);
		providerLatencyMs = attempt.latencyMs;

		if (!attempt.ok && shouldFallbackGeminiOcr(attempt.error)) {
			const firstClaim = providerClaims.get(providerPages[0]!.pageId)!;
			const primaryDecision = planOcrFailure(attempt.error, {
				attemptCount: firstClaim.attemptCount,
				failedAt: new Date(),
				jitterMs: 0
			});
			try {
				await supabase.rpc(
					'record_ocr_provider_usage',
					buildGeminiTelemetryRpcArgs({
						eventId: telemetryEventId,
						documentId,
						batchId: parsedRequest.batchId,
						model,
						promptVersion,
						documentKind: document.kind as 'image' | 'pdf',
						pages: providerPages,
						outcome: null,
						status: 'error',
						safeErrorCode: primaryDecision.persistence.code,
						latencyMs: providerLatencyMs,
						recordedAt: new Date().toISOString(),
						routeReason: 'primary_gemini'
					})
				);
			} catch {
				// The fallback must remain available even if primary-attempt telemetry fails.
			}

			activeModel = fallbackModel;
			activeRouteReason = 'fallback_gemini_rate_limit';
			telemetryEventId = crypto.randomUUID();
			attempt = await attemptProvider(fallbackModel, fallbackRpm);
			providerLatencyMs = attempt.latencyMs;
		}

		if (!attempt.ok) throw attempt.error;
		const outcome = attempt.outcome;

		try {
			await supabase.rpc(
				'record_ocr_provider_usage',
				buildGeminiTelemetryRpcArgs({
					eventId: telemetryEventId,
					documentId,
					batchId: parsedRequest.batchId,
					model: activeModel,
					promptVersion,
					documentKind: document.kind as 'image' | 'pdf',
					pages: providerPages,
					outcome,
					status: 'success',
					safeErrorCode: null,
					latencyMs: providerLatencyMs,
					recordedAt: new Date().toISOString(),
					routeReason: activeRouteReason
				})
			);
		} catch {
			// Telemetry is intentionally best-effort and must never fail a valid OCR result.
		}

		const validIds = new Set<string>();
		for (const result of outcome.pages) {
			const claimed = providerClaims.get(result.pageId);
			if (!claimed) continue;
			validIds.add(result.pageId);
			const { error: completionError } = await supabase.rpc('complete_ocr_job_with_geometry', {
				target_page_id: result.pageId,
				extracted_text: result.text,
				extraction_warnings: result.warnings,
				terminal_status: result.needsReview ? 'needs_review' : 'ready',
				completed_at: new Date().toISOString(),
				geometry_payload: result.wordGeometry
			});
			if (completionError) {
				await failJob(result.pageId, {
					code: 'ocr_persistence_failed',
					message: 'O resultado não pôde ser salvo com segurança.',
					retryable: true,
					failedAt: new Date().toISOString(),
					nextRetryAt: retryAt(claimed.attemptCount, 15)
				});
				pendingPageIds.push(result.pageId);
				continue;
			}
			completedPageIds.push(result.pageId);
			if (result.needsReview) reviewPageIds.push(result.pageId);
			const visualSource = providerSources.get(result.pageId);
			await enqueueVisualEmbeddingAfterOcr({
				supabase,
				pageId: result.pageId,
				mediaPath: visualSource?.mediaPath ?? null,
				mediaMimeType: visualSource?.mimeType ?? null,
				contentClass: result.contentClass,
				warnings: result.warnings,
				needsReview: result.needsReview,
				effectiveText: result.text,
				wordGeometry: result.wordGeometry
			});
			await cleanupTemporaryImage(result.pageId, claimed.page.temporary_image_path);
		}

		const splitIds = new Set([
			...outcome.missingPageIds,
			...outcome.duplicatePageIds,
			...providerPages
				.map((page) => page.pageId)
				.filter((pageId) => !validIds.has(pageId) && !outcome.unexpectedPageIds.includes(pageId))
		]);
		for (const pageId of splitIds) {
			const claimed = providerClaims.get(pageId);
			if (!claimed) continue;
			await failJob(pageId, {
				code: 'ocr_batch_response_incomplete',
				message: 'O lote retornou uma página ausente ou ambígua e será dividido.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(claimed.attemptCount, 5)
			});
			pendingPageIds.push(pageId);
			splitRequiredPageIds.push(pageId);
		}

		const body = aggregateBody({
			completedPageIds,
			reviewPageIds,
			pendingPageIds,
			failedPageIds,
			splitRequiredPageIds,
			unexpectedResultPageIds: outcome.unexpectedPageIds
		});
		await finishBatch(
			parsedRequest.batchId,
			body.state === 'complete' ? 'ready' : 'retryable',
			body.state === 'complete' ? null : 'ocr_batch_response_incomplete',
			body.state === 'complete' ? null : 'O lote precisa ser dividido ou repetido.',
			body.state === 'complete' ? null : retryAt(1, 5)
		);
		return respond(body.state === 'complete' ? 200 : 202, body);
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
				await failJob(page.pageId, {
					code,
					message,
					retryable: true,
					failedAt: failedAt.toISOString(),
					nextRetryAt
				});
				pendingPageIds.push(page.pageId);
			}
			await finishBatch(parsedRequest.batchId, 'retryable', code, message, nextRetryAt);
			return respond(
				202,
				aggregateBody({
					completedPageIds,
					reviewPageIds,
					pendingPageIds,
					failedPageIds,
					splitRequiredPageIds
				})
			);
		}

		const sharedFailedAt = new Date().toISOString();
		const decisions = providerPages.map((page) => {
			const claimed = providerClaims.get(page.pageId)!;
			return {
				pageId: page.pageId,
				decision: planOcrFailure(error, {
					attemptCount: claimed.attemptCount,
					failedAt: new Date(sharedFailedAt),
					jitterMs: 0
				})
			};
		});
		const batchQuotaBlocked = decisions.some(
			(entry) => entry.decision.persistence.kind === 'block_quota'
		);
		let batchRetryAt: string | null = null;
		let terminalStatus: 'retryable' | 'blocked_quota' | 'failed' = 'failed';
		let terminalCode = 'ocr_request_failed';
		let terminalMessage = 'O lote de OCR falhou.';
		for (const { pageId, decision } of decisions) {
			if (decision.persistence.kind === 'block_quota') {
				await blockQuota(pageId, decision.persistence.code, decision.persistence.failedAt);
				pendingPageIds.push(pageId);
				terminalStatus = 'blocked_quota';
				terminalCode = decision.persistence.code;
				terminalMessage = 'A cota diária do provedor foi atingida.';
				continue;
			}
			await failJob(pageId, decision.persistence);
			if (decision.persistence.retryable) {
				pendingPageIds.push(pageId);
				batchRetryAt = decision.persistence.nextRetryAt;
				if (!batchQuotaBlocked) terminalStatus = 'retryable';
			} else {
				failedPageIds.push(pageId);
			}
			terminalCode = decision.persistence.code;
			terminalMessage = decision.persistence.message;
		}

		try {
			await supabase.rpc(
				'record_ocr_provider_usage',
				buildGeminiTelemetryRpcArgs({
					eventId: telemetryEventId,
					documentId,
					batchId: parsedRequest.batchId,
					model: activeModel,
					promptVersion,
					documentKind: document.kind as 'image' | 'pdf',
					pages: providerPages,
					outcome: null,
					status: 'error',
					safeErrorCode: terminalCode,
					latencyMs: providerLatencyMs,
					recordedAt: sharedFailedAt,
					routeReason: activeRouteReason
				})
			);
		} catch {
			// Failure telemetry is also best-effort; the original OCR error remains authoritative.
		}

		await finishBatch(
			parsedRequest.batchId,
			terminalStatus,
			terminalCode,
			terminalMessage,
			batchRetryAt
		);
		const body = aggregateBody({
			completedPageIds,
			reviewPageIds,
			pendingPageIds,
			failedPageIds,
			splitRequiredPageIds
		});
		return respond(terminalStatus === 'failed' && pendingPageIds.length === 0 ? 503 : 202, body);
	}
});
