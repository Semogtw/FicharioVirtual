import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_BATCH_PAGES = 100;

export type OcrRunResult =
	| { state: 'complete'; needsReview: boolean; warningCount: number }
	| { state: 'already_complete'; needsReview: boolean }
	| { state: 'busy' }
	| { state: 'retry_later' }
	| { state: 'quota_exhausted' };

export type OcrBatchRunResult = {
	state: 'complete' | 'partial';
	completedPageIds: readonly string[];
	reviewPageIds: readonly string[];
	pendingPageIds: readonly string[];
	failedPageIds: readonly string[];
	splitRequiredPageIds: readonly string[];
	unexpectedResultPageIds: readonly string[];
};

type OcrFunctionBody = { pageId: string } | { pageIds: readonly string[]; batchId?: string };

export type OcrFunctionClient = {
	functions: {
		invoke(
			name: 'process-ocr',
			options: { body: OcrFunctionBody; signal?: AbortSignal }
		): Promise<{ data: unknown; error: null | { context?: unknown; message?: string } }>;
	};
};

export class OcrProcessingError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(code: string, retryable: boolean, message?: string) {
		super(message ?? 'Não foi possível concluir a leitura automática agora.');
		this.name = 'OcrProcessingError';
		this.code = code;
		this.retryable = retryable;
	}
}

function defaultClient(): OcrFunctionClient {
	return getSupabaseClient() as unknown as OcrFunctionClient;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

const CLAIM_REJECTION_ERRORS = Object.freeze({
	consent_required: Object.freeze({
		status: 403,
		code: 'ocr_consent_required',
		message: 'É necessário confirmar o consentimento de leitura automática.'
	}),
	not_authorized: Object.freeze({
		status: 403,
		code: 'ocr_not_authorized',
		message: 'Esta conta não está autorizada a usar a leitura automática.'
	}),
	not_found: Object.freeze({
		status: 404,
		code: 'ocr_page_not_found',
		message: 'A página não foi encontrada para leitura automática.'
	}),
	invalid_configuration: Object.freeze({
		status: 409,
		code: 'ocr_not_configured',
		message: 'A leitura automática ainda não foi configurada.'
	}),
	not_retryable: Object.freeze({
		status: 409,
		code: 'ocr_not_retryable',
		message: 'Esta página não pode mais ser processada automaticamente.'
	})
});

function parseErrorCode(body: Record<string, unknown>): string | null {
	const exactCode = hasExactKeys(body, ['code']);
	const exactCodeAndRetryability =
		hasExactKeys(body, ['code', 'retryable']) && typeof body.retryable === 'boolean';
	return (exactCode || exactCodeAndRetryability) &&
		typeof body.code === 'string' &&
		ERROR_CODE.test(body.code)
		? body.code
		: null;
}

async function mappedError(error: { context?: unknown; message?: string }) {
	if (!(error.context instanceof Response)) {
		return new OcrProcessingError(
			'ocr_transport_failed',
			true,
			'Não foi possível alcançar o serviço de leitura. As páginas continuarão pendentes.'
		);
	}

	const status = error.context.status;
	let body: Record<string, unknown> = {};
	try {
		const value = await error.context.clone().json();
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			body = value as Record<string, unknown>;
		}
	} catch {
		// Keep only the safe generic classification below.
	}

	if (hasExactKeys(body, ['state']) && typeof body.state === 'string') {
		const rejection = CLAIM_REJECTION_ERRORS[body.state as keyof typeof CLAIM_REJECTION_ERRORS];
		if (rejection?.status === status) {
			return new OcrProcessingError(rejection.code, false, rejection.message);
		}
	}

	const code = parseErrorCode(body) ?? `ocr_http_${status}`;
	const retryable =
		code === 'gemini_rate_limited' || status === 408 || status === 425 || status >= 500;
	const messages: Record<string, string> = {
		gemini_daily_quota: 'A cota real do provedor foi atingida. As páginas continuarão pendentes.',
		gemini_rate_limited: 'O provedor limitou temporariamente as leituras.',
		ocr_source_unavailable: 'A página não pôde ser carregada do armazenamento.',
		ocr_not_configured: 'A leitura automática ainda não foi configurada.',
		ocr_batch_too_many_pages: 'O lote precisa ser dividido em partes menores.'
	};
	return new OcrProcessingError(code, retryable, messages[code]);
}

function invalidResponse(): never {
	throw new OcrProcessingError('ocr_response_invalid', true);
}

function parseLegacyResult(data: unknown): OcrRunResult | null {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
	const value = data as Record<string, unknown>;
	if (value.state === 'complete' && hasExactKeys(value, ['state', 'needsReview', 'warningCount'])) {
		if (
			typeof value.needsReview !== 'boolean' ||
			!Number.isInteger(value.warningCount) ||
			(value.warningCount as number) < 0 ||
			(value.warningCount as number) > 100
		) {
			invalidResponse();
		}
		return Object.freeze({
			state: 'complete',
			needsReview: value.needsReview,
			warningCount: value.warningCount as number
		});
	}
	if (value.state === 'already_complete') {
		if (!hasExactKeys(value, ['state', 'needsReview']) || typeof value.needsReview !== 'boolean') {
			invalidResponse();
		}
		return Object.freeze({ state: 'already_complete', needsReview: value.needsReview });
	}
	if (
		value.state === 'busy' ||
		value.state === 'retry_later' ||
		value.state === 'quota_exhausted'
	) {
		if (!hasExactKeys(value, ['state'])) invalidResponse();
		return Object.freeze({ state: value.state });
	}
	return null;
}

function parseIdArray(value: unknown): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length > MAX_BATCH_PAGES ||
		value.some((entry) => typeof entry !== 'string' || !UUID.test(entry)) ||
		new Set(value).size !== value.length
	) {
		invalidResponse();
	}
	return Object.freeze([...(value as string[])]);
}

function parseBatchResult(data: unknown, requestedPageIds: readonly string[]): OcrBatchRunResult {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) invalidResponse();
	const value = data as Record<string, unknown>;
	if (
		!hasExactKeys(value, [
			'completedPageIds',
			'failedPageIds',
			'pendingPageIds',
			'reviewPageIds',
			'splitRequiredPageIds',
			'state',
			'unexpectedResultPageIds'
		]) ||
		(value.state !== 'complete' && value.state !== 'partial')
	) {
		invalidResponse();
	}

	const completedPageIds = parseIdArray(value.completedPageIds);
	const reviewPageIds = parseIdArray(value.reviewPageIds);
	const pendingPageIds = parseIdArray(value.pendingPageIds);
	const failedPageIds = parseIdArray(value.failedPageIds);
	const splitRequiredPageIds = parseIdArray(value.splitRequiredPageIds);
	const unexpectedResultPageIds = parseIdArray(value.unexpectedResultPageIds);
	const requested = new Set(requestedPageIds);
	const completed = new Set(completedPageIds);
	const pending = new Set(pendingPageIds);
	const failed = new Set(failedPageIds);

	if (
		[...completedPageIds, ...pendingPageIds, ...failedPageIds].some(
			(pageId) => !requested.has(pageId)
		) ||
		reviewPageIds.some((pageId) => !completed.has(pageId)) ||
		splitRequiredPageIds.some((pageId) => !pending.has(pageId)) ||
		unexpectedResultPageIds.some((pageId) => requested.has(pageId)) ||
		completedPageIds.some((pageId) => pending.has(pageId) || failed.has(pageId)) ||
		pendingPageIds.some((pageId) => failed.has(pageId)) ||
		requestedPageIds.some(
			(pageId) => !completed.has(pageId) && !pending.has(pageId) && !failed.has(pageId)
		) ||
		(value.state === 'complete' && (pendingPageIds.length > 0 || failedPageIds.length > 0)) ||
		(value.state === 'partial' && pendingPageIds.length === 0 && failedPageIds.length === 0)
	) {
		invalidResponse();
	}

	return Object.freeze({
		state: value.state,
		completedPageIds,
		reviewPageIds,
		pendingPageIds,
		failedPageIds,
		splitRequiredPageIds,
		unexpectedResultPageIds
	});
}

function abortError() {
	return new DOMException('OCR request was cancelled', 'AbortError');
}

function validatePageIds(pageIds: readonly string[]) {
	if (
		pageIds.length < 1 ||
		pageIds.length > MAX_BATCH_PAGES ||
		pageIds.some((pageId) => !UUID.test(pageId)) ||
		new Set(pageIds).size !== pageIds.length
	) {
		throw new TypeError('Invalid page identifiers');
	}
}

export async function processOcrBatch(
	pageIds: readonly string[],
	client?: OcrFunctionClient,
	options: { batchId?: string; signal?: AbortSignal } = {}
): Promise<OcrBatchRunResult> {
	validatePageIds(pageIds);
	if (options.batchId !== undefined && !UUID.test(options.batchId)) {
		throw new TypeError('Invalid OCR batch identifier');
	}
	if (options.signal?.aborted) throw abortError();
	const gateway = client ?? defaultClient();
	const body: OcrFunctionBody = options.batchId
		? { pageIds: Object.freeze([...pageIds]), batchId: options.batchId }
		: { pageIds: Object.freeze([...pageIds]) };
	const { data, error } = await gateway.functions.invoke('process-ocr', {
		body,
		signal: options.signal
	});
	if (options.signal?.aborted) throw abortError();
	if (error) throw await mappedError(error);
	return parseBatchResult(data, pageIds);
}

export async function processPageOcr(
	pageId: string,
	client?: OcrFunctionClient,
	options: { signal?: AbortSignal } = {}
): Promise<OcrRunResult> {
	if (!UUID.test(pageId)) throw new TypeError('Invalid page identifier');
	if (options.signal?.aborted) throw abortError();
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.functions.invoke('process-ocr', {
		body: { pageId },
		signal: options.signal
	});
	if (options.signal?.aborted) throw abortError();
	if (error) throw await mappedError(error);
	const legacy = parseLegacyResult(data);
	if (legacy) return legacy;
	const batch = parseBatchResult(data, [pageId]);
	if (batch.completedPageIds.includes(pageId)) {
		return Object.freeze({
			state: 'already_complete',
			needsReview: batch.reviewPageIds.includes(pageId)
		});
	}
	if (batch.pendingPageIds.includes(pageId)) return Object.freeze({ state: 'retry_later' });
	throw new OcrProcessingError('ocr_not_retryable', false);
}
