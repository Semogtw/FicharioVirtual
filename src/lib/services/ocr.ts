import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z][a-z0-9_]{1,63}$/;

export type OcrRunResult =
	| { state: 'complete'; needsReview: boolean; warningCount: number }
	| { state: 'already_complete'; needsReview: boolean }
	| { state: 'busy' }
	| { state: 'retry_later' }
	| { state: 'quota_exhausted' };

export type OcrFunctionClient = {
	functions: {
		invoke(
			name: 'process-ocr',
			options: { body: { pageId: string }; signal?: AbortSignal }
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
			'Não foi possível alcançar o serviço de leitura. A página continuará pendente.'
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
	const retryable = status === 408 || status === 425 || status >= 500;
	const messages: Record<string, string> = {
		gemini_daily_quota: 'A cota diária de leitura foi atingida. As páginas continuarão pendentes.',
		gemini_rate_limited: 'O provedor limitou temporariamente as leituras.',
		ocr_source_unavailable: 'A página não pôde ser carregada do armazenamento.',
		ocr_not_configured: 'A leitura automática ainda não foi configurada.'
	};
	return new OcrProcessingError(code, retryable, messages[code]);
}

function parseResult(data: unknown): OcrRunResult {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) {
		throw new OcrProcessingError('ocr_response_invalid', true);
	}
	const value = data as Record<string, unknown>;
	if (value.state === 'complete') {
		if (
			!hasExactKeys(value, ['state', 'needsReview', 'warningCount']) ||
			typeof value.needsReview !== 'boolean' ||
			!Number.isInteger(value.warningCount) ||
			(value.warningCount as number) < 0 ||
			(value.warningCount as number) > 100
		) {
			throw new OcrProcessingError('ocr_response_invalid', true);
		}
		return Object.freeze({
			state: 'complete',
			needsReview: value.needsReview,
			warningCount: value.warningCount as number
		});
	}
	if (value.state === 'already_complete') {
		if (!hasExactKeys(value, ['state', 'needsReview']) || typeof value.needsReview !== 'boolean') {
			throw new OcrProcessingError('ocr_response_invalid', true);
		}
		return Object.freeze({ state: 'already_complete', needsReview: value.needsReview });
	}
	if (
		value.state === 'busy' ||
		value.state === 'retry_later' ||
		value.state === 'quota_exhausted'
	) {
		if (!hasExactKeys(value, ['state'])) {
			throw new OcrProcessingError('ocr_response_invalid', true);
		}
		return Object.freeze({ state: value.state });
	}
	throw new OcrProcessingError('ocr_response_invalid', true);
}

function abortError() {
	return new DOMException('OCR request was cancelled', 'AbortError');
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
	return parseResult(data);
}
