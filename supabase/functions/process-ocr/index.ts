import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { claimStateHttpStatus, parseOcrClaimResult } from '../_shared/ocr-contract.ts';
import { planOcrFailure } from '../_shared/ocr-failure.ts';
import { requestGeminiOcrBatch, type GeminiOcrBatchPage } from '../_shared/gemini-ocr-client.ts';
import {
	classifyGeminiDiagnosticFailure,
	createGeminiDiagnosticResult,
	decodeGeminiDiagnosticFixture,
	GEMINI_DIAGNOSTIC_PAGE,
	hasServiceRoleClaim,
	isGeminiDiagnosticRequest
} from '../_shared/gemini-diagnostic-contract.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const MAX_INLINE_IMAGE_BYTES = 14 * 1024 * 1024;
const ABSOLUTE_MAX_BATCH_PAGES = 100;
const ABSOLUTE_MAX_BATCH_BYTES = 14 * 1024 * 1024;

type ParsedRequest = {
	pageIds: readonly string[];
	batchId: string | null;
	legacy: boolean;
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
	if (hasExactKeys(record, ['pageId'])) {
		return typeof record.pageId === 'string' && UUID.test(record.pageId)
			? Object.freeze({ pageIds: Object.freeze([record.pageId]), batchId: null, legacy: true })
			: null;
	}
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
		batchId: typeof record.batchId === 'string' ? record.batchId : null,
		legacy: false
	});
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function retryAt(attemptCount: number, baseSeconds: number) {
	const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
	const jitter = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
	const delayMs = Math.min(60 * 60 * 1000, baseSeconds * 1000 * 2 ** exponent + jitter);
	return new Date(Date.now() + delayMs).toISOString();
}

async function runGeminiDiagnostic(
	authorization: string,
	respond: (status: number, body: Record<string, unknown>) => Response
) {
	if (!hasServiceRoleClaim(authorization)) {
		const result = createGeminiDiagnosticResult({
			status: 'fail',
			category: 'authorization',
			code: 'diagnostic_forbidden',
			httpStatus: 403
		});
		return respond(403, { ...result });
	}

	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const model = Deno.env.get('OCR_MODEL_PRIMARY');
	const promptVersion = Number(Deno.env.get('OCR_PROMPT_VERSION') ?? '1');
	if (
		!apiKey ||
		!model ||
		!MODEL.test(model) ||
		!Number.isInteger(promptVersion) ||
		promptVersion < 1 ||
		promptVersion > 10_000
	) {
		const result = createGeminiDiagnosticResult({
			status: 'fail',
			category: 'configuration',
			code: 'provider_not_configured',
			httpStatus: 503
		});
		return respond(503, { ...result });
	}

	try {
		const outcome = await requestGeminiOcrBatch({
			apiKey,
			model,
			promptVersion,
			pages: [
				{
					...GEMINI_DIAGNOSTIC_PAGE,
					bytes: decodeGeminiDiagnosticFixture()
				}
			]
		});
		if (!outcome.valid) {
			const result = createGeminiDiagnosticResult({
				status: 'fail',
				category: 'provider',
				code: 'provider_response_invalid',
				httpStatus: 200
			});
			return respond(502, { ...result });
		}
		const result = createGeminiDiagnosticResult({
			status: 'pass',
			category: 'provider',
			code: 'provider_ok',
			httpStatus: 200
		});
		return respond(200, { ...result });
	} catch (error) {
		const result = classifyGeminiDiagnosticFailure(error);
		const status =
			result.category === 'provider' && result.httpStatus !== null && result.httpStatus >= 400
				? result.httpStatus
				: 502;
		return respond(status, { ...result });
	}
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
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
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
		rawBody = await request.json();
	} catch {
		return respond(400, { code: 'invalid_json' });
	}
	if (isGeminiDiagnosticRequest(rawBody)) {
		return runGeminiDiagnostic(authorization, respond);
	}
	const parsedRequest = parseRequestBody(rawBody);
	if (!parsedRequest) return respond(400, { code: 'invalid_ocr_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	const model = Deno.env.get('OCR_MODEL_PRIMARY');
	const promptVersion = Number(Deno.env.get('OCR_PROMPT_VERSION') ?? '1');
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
		!apiKey ||
		!model ||
		!MODEL.test(model) ||
		!Number.isInteger(promptVersion) ||
		promptVersion < 1 ||
		promptVersion > 10_000 ||
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
			if (parsedRequest.legacy) {
				return respond(claimStateHttpStatus(claimResult.state), { state: claimResult.state });
			}
			continue;
		}
		if (claimResult.state === 'not_retryable') {
			failedPageIds.push(page.id);
			if (parsedRequest.legacy) {
				return respond(claimStateHttpStatus(claimResult.state), { state: claimResult.state });
			}
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
				message: 'A página excede o limite seguro e precisa ser renderizada novamente.',
				retryable: false,
				failedAt: new Date().toISOString(),
				nextRetryAt: null
			});
			failedPageIds.push(claimed.page.id);
			continue;
		}
		if (providerPages.length > 0 && aggregateBytes + sourceBlob.size > maxBatchBytes) {
			for (const remainder of claimedPages.slice(index)) {
				const nextRetryAt = retryAt(remainder.attemptCount, 1);
				await failJob(remainder.page.id, {
					code: 'ocr_batch_split_required',
					message: 'O lote excedeu o limite seguro e será dividido automaticamente.',
					retryable: true,
					failedAt: new Date().toISOString(),
					nextRetryAt
				});
				pendingPageIds.push(remainder.page.id);
				splitRequiredPageIds.push(remainder.page.id);
			}
			break;
		}

		const bytes = new Uint8Array(await sourceBlob.arrayBuffer());
		providerPages.push({
			pageId: claimed.page.id,
			pageNumber: claimed.page.page_number,
			mimeType: sourceBlob.type || 'image/jpeg',
			bytes
		});
		providerClaims.set(claimed.page.id, claimed);
		aggregateBytes += sourceBlob.size;
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

	let activeBatchId = parsedRequest.batchId;
	if (!activeBatchId) {
		const { data: registeredBatchId, error: registerError } = await supabase.rpc(
			'register_ocr_batch',
			{
				target_document_id: documentId,
				target_route: 'gemini',
				target_page_ids: providerPages.map((page) => page.pageId),
				target_page_numbers: providerPages.map((page) => page.pageNumber),
				target_source_bytes: 0,
				target_derived_bytes: aggregateBytes,
				target_split_depth: 0,
				target_parent_batch_id: null,
				target_model: model,
				target_prompt_version: promptVersion,
				registered_at: new Date().toISOString()
			}
		);
		if (registerError || typeof registeredBatchId !== 'string' || !UUID.test(registeredBatchId)) {
			for (const providerPage of providerPages) {
				const claimed = providerClaims.get(providerPage.pageId)!;
				await failJob(providerPage.pageId, {
					code: 'ocr_batch_registration_failed',
					message: 'O manifesto do lote não pôde ser persistido.',
					retryable: true,
					failedAt: new Date().toISOString(),
					nextRetryAt: retryAt(claimed.attemptCount, 5)
				});
			}
			providerPages.forEach((page) => page.bytes.fill(0));
			return respond(503, { code: 'ocr_batch_registration_failed' });
		}
		activeBatchId = registeredBatchId;
	}

	const { data: callRecorded, error: callError } = await supabase.rpc('record_ocr_batch_call', {
		target_batch_id: activeBatchId,
		attempted_pages: providerPages.length,
		called_at: new Date().toISOString()
	});
	if (callError || callRecorded !== true) {
		for (const providerPage of providerPages) {
			const claimed = providerClaims.get(providerPage.pageId)!;
			await failJob(providerPage.pageId, {
				code: 'ocr_batch_telemetry_failed',
				message: 'A chamada não foi iniciada porque sua telemetria não pôde ser registrada.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(claimed.attemptCount, 5)
			});
		}
		providerPages.forEach((page) => page.bytes.fill(0));
		return respond(503, { code: 'ocr_batch_telemetry_failed' });
	}

	const timeout = new AbortController();
	const timeoutId = setTimeout(() => timeout.abort(), requestTimeoutMs);
	try {
		const outcome = await requestGeminiOcrBatch({
			apiKey,
			model,
			pages: providerPages,
			promptVersion,
			signal: timeout.signal
		});
		const completedAt = new Date().toISOString();
		for (const pageResult of outcome.pages) {
			const claimed = providerClaims.get(pageResult.pageId);
			if (!claimed) continue;
			const { data: completed, error: completionError } = await supabase.rpc('complete_ocr_job', {
				target_page_id: pageResult.pageId,
				extracted_text: pageResult.text,
				extraction_warnings: pageResult.warnings,
				terminal_status: pageResult.needsReview ? 'needs_review' : 'ready',
				completed_at: completedAt
			});
			if (completionError || completed !== true) {
				await failJob(pageResult.pageId, {
					code: 'ocr_completion_failed',
					message: 'A transcrição foi recebida, mas ainda não pôde ser persistida.',
					retryable: true,
					failedAt: completedAt,
					nextRetryAt: retryAt(claimed.attemptCount, 5)
				});
				pendingPageIds.push(pageResult.pageId);
				continue;
			}
			completedPageIds.push(pageResult.pageId);
			if (pageResult.needsReview) reviewPageIds.push(pageResult.pageId);
			await cleanupTemporaryImage(pageResult.pageId, claimed.page.temporary_image_path);
		}

		const affected = new Set([...outcome.missingPageIds, ...outcome.duplicatePageIds]);
		for (const pageId of affected) {
			const claimed = providerClaims.get(pageId);
			if (!claimed) continue;
			await failJob(pageId, {
				code: 'ocr_batch_split_required',
				message: 'A resposta não preservou esta página; o subconjunto será dividido e repetido.',
				retryable: true,
				failedAt: completedAt,
				nextRetryAt: retryAt(claimed.attemptCount, 1)
			});
			pendingPageIds.push(pageId);
			splitRequiredPageIds.push(pageId);
		}

		const batchHasPending = pendingPageIds.length > 0;
		const batchHasFailed = failedPageIds.length > 0;
		const batchFinished = await finishBatch(
			activeBatchId,
			batchHasPending ? 'retryable' : batchHasFailed ? 'failed' : 'ready',
			batchHasPending
				? 'ocr_batch_split_required'
				: batchHasFailed
					? 'ocr_batch_page_failed'
					: null,
			batchHasPending
				? 'Parte do lote continuará pendente em um subconjunto menor.'
				: batchHasFailed
					? 'Uma ou mais páginas falharam permanentemente.'
					: null,
			batchHasPending ? retryAt(1, 1) : null
		);
		if (!batchFinished) return respond(503, { code: 'ocr_batch_completion_failed' });

		if (parsedRequest.legacy) {
			const pageId = parsedRequest.pageIds[0]!;
			if (completedPageIds.includes(pageId)) {
				return respond(200, {
					state: 'complete',
					needsReview: reviewPageIds.includes(pageId),
					warningCount: outcome.pages[0]?.warnings.length ?? 0
				});
			}
			if (pendingPageIds.includes(pageId)) return respond(202, { state: 'retry_later' });
			return respond(409, { code: 'ocr_not_retryable', retryable: false });
		}

		const result = aggregateBody({
			completedPageIds,
			reviewPageIds,
			pendingPageIds,
			failedPageIds,
			splitRequiredPageIds,
			unexpectedResultPageIds: outcome.unexpectedPageIds
		});
		return respond(pendingPageIds.length > 0 ? 202 : 200, result);
	} catch (error) {
		const maximumAttempt = Math.max(
			...providerPages.map((page) => providerClaims.get(page.pageId)?.attemptCount ?? 1)
		);
		const responseDecision = planOcrFailure(error, {
			attemptCount: maximumAttempt,
			failedAt: new Date()
		});
		let persistenceFailed = false;
		for (const providerPage of providerPages) {
			const attemptCount = providerClaims.get(providerPage.pageId)?.attemptCount ?? 1;
			const decision = planOcrFailure(error, { attemptCount, failedAt: new Date() });
			const persisted =
				decision.persistence.kind === 'block_quota'
					? await blockQuota(
							providerPage.pageId,
							decision.persistence.code,
							decision.persistence.failedAt
						)
					: await failJob(providerPage.pageId, decision.persistence);
			persistenceFailed ||= !persisted;
			if (decision.persistence.kind === 'block_quota' || decision.persistence.retryable) {
				pendingPageIds.push(providerPage.pageId);
			} else {
				failedPageIds.push(providerPage.pageId);
			}
		}
		if (persistenceFailed) return respond(503, { code: 'ocr_failure_persistence_failed' });

		const batchStatus =
			responseDecision.persistence.kind === 'block_quota'
				? 'blocked_quota'
				: responseDecision.persistence.retryable
					? 'retryable'
					: 'failed';
		const retryAtValue =
			responseDecision.persistence.kind === 'block_quota'
				? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
				: responseDecision.persistence.nextRetryAt;
		await finishBatch(
			activeBatchId,
			batchStatus,
			responseDecision.persistence.code,
			responseDecision.persistence.kind === 'block_quota'
				? 'A cota real do provedor foi atingida.'
				: responseDecision.persistence.message,
			retryAtValue
		);

		if (parsedRequest.legacy) {
			return respond(responseDecision.response.status, responseDecision.response.body);
		}
		return respond(
			responseDecision.response.status,
			aggregateBody({
				completedPageIds,
				reviewPageIds,
				pendingPageIds,
				failedPageIds,
				splitRequiredPageIds
			})
		);
	} finally {
		clearTimeout(timeoutId);
		providerPages.forEach((page) => page.bytes.fill(0));
	}
});
