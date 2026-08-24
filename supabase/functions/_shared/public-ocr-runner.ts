import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
	createAzureOcrProvider,
	AzureOcrEligibilityError,
	AzureOcrHttpError,
	AzureOcrOperationFailedError,
	AzureOcrResponseError,
	AzureOcrTransportError
} from './azure-ocr-client.ts';
import { claimStateHttpStatus, parseOcrClaimResult } from './ocr-contract.ts';
import { buildAzureTelemetryRpcArgs } from './ocr-provider-telemetry.ts';
import { randomJitterMs } from './random-jitter.ts';
import type { PublicOcrRequest } from './public-ocr-contract.ts';
import { visualTemporaryMediaIsNeeded } from './visual-embedding-enqueue.ts';
import type { OcrProviderPage } from './ocr-provider.ts';

const ABSOLUTE_MAX_BATCH_PAGES = 100;
const DEFAULT_MAX_BATCH_PAGES = 20;
const DEFAULT_MAX_IMAGE_BYTES = 3_800_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

type PageRow = Readonly<{
	id: string;
	status: string;
	temporary_image_path: string | null;
	document_id: string;
	page_number: number;
	ocr_raw_text: string | null;
	corrected_text: string | null;
}>;

type ClaimedPage = Readonly<{ page: PageRow; attemptCount: number }>;

type Respond = (status: number, body: Record<string, unknown>) => Response;

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

function mimeFromPath(path: string) {
	const normalized = path.toLowerCase().split('?', 1)[0];
	if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
	if (normalized.endsWith('.png')) return 'image/png';
	return '';
}

function failureFor(error: unknown, attemptCount: number) {
	const retryable =
		error instanceof AzureOcrTransportError ||
		error instanceof AzureOcrResponseError ||
		error instanceof AzureOcrOperationFailedError ||
		(error instanceof AzureOcrHttpError &&
			(error.status === 408 || error.status === 429 || error.status >= 500));
	const code =
		error instanceof AzureOcrEligibilityError
			? 'ocr_azure_source_ineligible'
			: error instanceof AzureOcrHttpError && error.status === 401
				? 'ocr_azure_authentication_failed'
				: error instanceof AzureOcrHttpError && error.status === 403
					? 'ocr_azure_authorization_failed'
					: error instanceof AzureOcrHttpError && error.status === 429
						? 'ocr_azure_rate_limited'
						: error instanceof AzureOcrResponseError
							? 'ocr_azure_response_invalid'
							: error instanceof AzureOcrOperationFailedError
								? 'ocr_azure_operation_failed'
								: 'ocr_azure_request_failed';
	const boundedRetryable = retryable && attemptCount < 3;
	return {
		code,
		message:
			error instanceof AzureOcrEligibilityError
				? 'A imagem desta página não é compatível com o OCR público.'
				: 'A leitura pública não pôde ser concluída agora.',
		retryable: boundedRetryable,
		failedAt: new Date().toISOString(),
		nextRetryAt: boundedRetryable ? retryAt(attemptCount, 30) : null
	};
}

export async function runPublicOcr(input: {
	supabase: SupabaseClient;
	request: Request;
	parsedRequest: PublicOcrRequest;
	respond: Respond;
}) {
	const maxBatchPages = envInteger(
		'OCR_AZURE_MAX_BATCH_PAGES',
		DEFAULT_MAX_BATCH_PAGES,
		1,
		ABSOLUTE_MAX_BATCH_PAGES
	);
	const maxImageBytes = envInteger(
		'OCR_AZURE_MAX_IMAGE_BYTES',
		DEFAULT_MAX_IMAGE_BYTES,
		1,
		3_799_999
	);
	const pollIntervalMs = envInteger(
		'OCR_AZURE_POLL_INTERVAL_MS',
		DEFAULT_POLL_INTERVAL_MS,
		1,
		60_000
	);
	const pollTimeoutMs = envInteger(
		'OCR_AZURE_POLL_TIMEOUT_MS',
		DEFAULT_POLL_TIMEOUT_MS,
		1,
		180_000
	);
	const requestTimeoutMs = envInteger(
		'OCR_REQUEST_TIMEOUT_MS',
		DEFAULT_REQUEST_TIMEOUT_MS,
		10_000,
		140_000
	);
	const endpoint = Deno.env.get('AZURE_VISION_ENDPOINT');
	const apiKey = Deno.env.get('AZURE_VISION_KEY');
	if (
		!endpoint ||
		!apiKey ||
		maxBatchPages === null ||
		maxImageBytes === null ||
		pollIntervalMs === null ||
		pollTimeoutMs === null ||
		requestTimeoutMs === null ||
		pollTimeoutMs < pollIntervalMs
	) {
		return input.respond(503, { code: 'ocr_not_configured' });
	}
	if (input.parsedRequest.pageIds.length > maxBatchPages) {
		return input.respond(413, { code: 'ocr_batch_too_many_pages', splitRequired: true });
	}

	let provider;
	try {
		provider = createAzureOcrProvider({
			endpoint,
			apiKey,
			maxImageBytes,
			pollIntervalMs,
			pollTimeoutMs
		});
	} catch {
		return input.respond(503, { code: 'ocr_not_configured' });
	}

	const { data: pageData, error: pageError } = await input.supabase
		.from('pages')
		.select('id,status,temporary_image_path,document_id,page_number,ocr_raw_text,corrected_text')
		.in('id', [...input.parsedRequest.pageIds]);
	if (pageError) return input.respond(503, { code: 'page_lookup_failed' });
	if (!Array.isArray(pageData) || pageData.length !== input.parsedRequest.pageIds.length) {
		return input.respond(404, { code: 'page_not_found' });
	}
	const pages = (pageData as PageRow[]).sort((left, right) => left.page_number - right.page_number);
	if (new Set(pages.map((page) => page.document_id)).size !== 1) {
		return input.respond(400, { code: 'ocr_batch_mixed_documents' });
	}
	const documentId = pages[0]!.document_id;

	if (input.parsedRequest.batchId) {
		const { data: registeredBatch, error: batchError } = await input.supabase
			.from('ocr_batches')
			.select('id,document_id,page_ids')
			.eq('id', input.parsedRequest.batchId)
			.maybeSingle();
		if (batchError) return input.respond(503, { code: 'ocr_batch_lookup_failed' });
		if (!registeredBatch) return input.respond(404, { code: 'ocr_batch_not_found' });
		const registeredIds = new Set(
			Array.isArray(registeredBatch.page_ids) ? registeredBatch.page_ids : []
		);
		if (
			registeredBatch.document_id !== documentId ||
			input.parsedRequest.pageIds.some((pageId) => !registeredIds.has(pageId))
		) {
			return input.respond(409, { code: 'ocr_batch_manifest_mismatch' });
		}
	}

	const completedPageIds: string[] = [];
	const reviewPageIds: string[] = [];
	const pendingPageIds: string[] = [];
	const failedPageIds: string[] = [];
	const splitRequiredPageIds: string[] = [];
	const claimedPages: ClaimedPage[] = [];
	const claimedAt = new Date().toISOString();

	const failJob = async (pageId: string, failure: ReturnType<typeof failureFor>) => {
		const { data, error } = await input.supabase.rpc('fail_ocr_job', {
			target_page_id: pageId,
			error_code: failure.code,
			safe_error_message: failure.message,
			retryable: failure.retryable,
			failed_at: failure.failedAt,
			retry_at: failure.nextRetryAt
		});
		return !error && data === true;
	};

	const releaseClaimedPages = async () => {
		for (const claimed of claimedPages) {
			await failJob(claimed.page.id, {
				code: 'ocr_public_claim_aborted',
				message: 'O lote público foi liberado após uma rejeição de configuração.',
				retryable: true,
				failedAt: new Date().toISOString(),
				nextRetryAt: retryAt(claimed.attemptCount, 5)
			});
		}
	};

	const cleanupTemporaryImage = async (pageId: string, path: string | null) => {
		if (
			!path ||
			(await visualTemporaryMediaIsNeeded({ supabase: input.supabase, pageId, mediaPath: path }))
		)
			return;
		const { error } = await input.supabase.storage.from('documents').remove([path]);
		if (!error) {
			await input.supabase.rpc('clear_temporary_page_image', {
				target_page_id: pageId,
				expected_storage_path: path
			});
		}
	};

	const finishBatch = async (
		status: 'ready' | 'retryable' | 'failed',
		code: string | null,
		message: string | null,
		nextRetryAt: string | null
	) => {
		if (!input.parsedRequest.batchId) return true;
		const { data, error } = await input.supabase.rpc('finish_ocr_batch', {
			target_batch_id: input.parsedRequest.batchId,
			terminal_status: status,
			error_code: code,
			safe_error_message: message,
			retry_at: nextRetryAt,
			finished_at: new Date().toISOString()
		});
		return !error && data === true;
	};

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
		const { data: claim, error: claimError } = await input.supabase.rpc(
			'claim_public_azure_ocr_job',
			{ target_page_id: page.id, target_model: 'read-v3.2', claimed_at: claimedAt }
		);
		const claimResult =
			!claimError && claim && typeof claim === 'object' ? parseOcrClaimResult(claim) : null;
		if (!claimResult) return input.respond(503, { code: 'ocr_claim_failed' });
		if (claimResult.state === 'claimed') {
			claimedPages.push({ page, attemptCount: claimResult.attemptCount });
			continue;
		}
		if (claimResult.state === 'already_complete') {
			completedPageIds.push(page.id);
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
		await releaseClaimedPages();
		return input.respond(claimStateHttpStatus(claimResult.state), { state: claimResult.state });
	}

	if (claimedPages.length === 0) {
		const body = aggregateBody({
			completedPageIds,
			reviewPageIds,
			pendingPageIds,
			failedPageIds,
			splitRequiredPageIds
		});
		return input.respond(pendingPageIds.length > 0 ? 202 : 200, body);
	}

	const { data: document, error: documentError } = await input.supabase
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
		return input.respond(409, { code: 'ocr_source_missing' });
	}

	const telemetryPages: OcrProviderPage[] = [];
	const telemetryEventId = crypto.randomUUID();
	for (const claimed of claimedPages) {
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
		const { data: sourceBlob, error: sourceError } = await input.supabase.storage
			.from('documents')
			.download(sourcePath);
		if (sourceError || !sourceBlob) {
			const failure = failureFor(new AzureOcrTransportError(), claimed.attemptCount);
			await failJob(claimed.page.id, failure);
			pendingPageIds.push(claimed.page.id);
			continue;
		}
		const mimeType = (sourceBlob.type || mimeFromPath(sourcePath)).toLowerCase();
		const bytes = new Uint8Array(await sourceBlob.arrayBuffer());
		telemetryPages.push({
			pageId: claimed.page.id,
			pageNumber: claimed.page.page_number,
			mimeType,
			bytes
		});
		const abortController = new AbortController();
		const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs);
		const startedAt = performance.now();
		try {
			const outcome = await provider.requestBatch({
				model: 'read-v3.2',
				pages: [telemetryPages[telemetryPages.length - 1]!],
				promptVersion: 1,
				signal: abortController.signal
			});
			try {
				await input.supabase.rpc(
					'record_ocr_provider_usage',
					buildAzureTelemetryRpcArgs({
						eventId: telemetryEventId,
						documentId,
						batchId: input.parsedRequest.batchId,
						model: 'read-v3.2',
						promptVersion: 1,
						documentKind: document.kind as 'image' | 'pdf',
						pages: [telemetryPages[telemetryPages.length - 1]!],
						outcome,
						status: 'success',
						safeErrorCode: null,
						latencyMs: performance.now() - startedAt,
						recordedAt: new Date().toISOString()
					})
				);
			} catch {
				// Telemetry is best effort and never changes the persisted OCR result.
			}
			const result = outcome.pages[0];
			if (!result) throw new AzureOcrResponseError();
			const { error: completionError } = await input.supabase.rpc(
				'complete_ocr_job_with_geometry',
				{
					target_page_id: result.pageId,
					extracted_text: result.text,
					extraction_warnings: result.warnings,
					terminal_status: result.needsReview ? 'needs_review' : 'ready',
					completed_at: new Date().toISOString(),
					geometry_payload: result.wordGeometry
				}
			);
			if (completionError) throw new AzureOcrResponseError();
			completedPageIds.push(result.pageId);
			if (result.needsReview) reviewPageIds.push(result.pageId);
			await cleanupTemporaryImage(result.pageId, claimed.page.temporary_image_path);
		} catch (error) {
			const failure = failureFor(error, claimed.attemptCount);
			await failJob(claimed.page.id, failure);
			if (failure.retryable) pendingPageIds.push(claimed.page.id);
			else failedPageIds.push(claimed.page.id);
			try {
				await input.supabase.rpc(
					'record_ocr_provider_usage',
					buildAzureTelemetryRpcArgs({
						eventId: crypto.randomUUID(),
						documentId,
						batchId: input.parsedRequest.batchId,
						model: 'read-v3.2',
						promptVersion: 1,
						documentKind: document.kind as 'image' | 'pdf',
						pages: [telemetryPages[telemetryPages.length - 1]!],
						outcome: null,
						status: 'error',
						safeErrorCode: failure.code,
						latencyMs: performance.now() - startedAt,
						recordedAt: failure.failedAt
					})
				);
			} catch {
				// Failure telemetry is also best effort.
			}
		} finally {
			clearTimeout(timeout);
		}
	}

	const body = aggregateBody({
		completedPageIds,
		reviewPageIds,
		pendingPageIds,
		failedPageIds,
		splitRequiredPageIds
	});
	await finishBatch(
		body.state === 'complete'
			? 'ready'
			: failedPageIds.length > 0 && pendingPageIds.length === 0
				? 'failed'
				: 'retryable',
		body.state === 'complete' ? null : 'ocr_public_azure_failed',
		body.state === 'complete' ? null : 'O OCR público precisa ser repetido.',
		body.state === 'complete' ? null : retryAt(1, 30)
	);
	return input.respond(body.state === 'complete' ? 200 : 202, body);
}
