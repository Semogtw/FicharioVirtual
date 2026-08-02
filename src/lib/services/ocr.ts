import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OcrRunResult =
	| { state: 'complete'; needsReview: boolean; warningCount: number }
	| { state: 'already_complete' }
	| { state: 'busy' }
	| { state: 'retry_later' }
	| { state: 'quota_exhausted' };

export type OcrFunctionClient = {
	functions: {
		invoke(
			name: 'process-ocr',
			options: { body: { pageId: string } }
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

async function mappedError(error: { context?: unknown; message?: string }) {
	let status = 0;
	let body: Record<string, unknown> = {};
	if (error.context instanceof Response) {
		status = error.context.status;
		try {
			const value = await error.context.clone().json();
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				body = value as Record<string, unknown>;
			}
		} catch {
			// Keep only the safe generic classification below.
		}
	}
	const code = typeof body.code === 'string' ? body.code : `ocr_http_${status || 'unknown'}`;
	const retryable = body.retryable === true || status === 408 || status === 425 || status >= 500;
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
			typeof value.needsReview !== 'boolean' ||
			!Number.isInteger(value.warningCount) ||
			(value.warningCount as number) < 0
		) {
			throw new OcrProcessingError('ocr_response_invalid', true);
		}
		return Object.freeze({
			state: 'complete',
			needsReview: value.needsReview,
			warningCount: value.warningCount as number
		});
	}
	if (
		value.state === 'already_complete' ||
		value.state === 'busy' ||
		value.state === 'retry_later' ||
		value.state === 'quota_exhausted'
	) {
		return Object.freeze({ state: value.state });
	}
	throw new OcrProcessingError('ocr_response_invalid', true);
}

export async function processPageOcr(
	pageId: string,
	client?: OcrFunctionClient
): Promise<OcrRunResult> {
	if (!UUID.test(pageId)) throw new TypeError('Invalid page identifier');
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.functions.invoke('process-ocr', { body: { pageId } });
	if (error) throw await mappedError(error);
	return parseResult(data);
}
