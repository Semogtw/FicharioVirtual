import { classifyGeminiFailure, geminiFailureResponse } from './ocr-contract.ts';
import {
	GeminiHttpError,
	GeminiResponseError,
	GeminiTransportError
} from './gemini-ocr-client.ts';

export type OcrFailurePersistence =
	| {
			kind: 'block_quota';
			code: string;
			failedAt: string;
	  }
	| {
			kind: 'fail_job';
			code: string;
			message: string;
			retryable: boolean;
			failedAt: string;
			nextRetryAt: string | null;
	  };

export type OcrFailureDecision = {
	persistence: OcrFailurePersistence;
	response: {
		status: number;
		body: Record<string, unknown>;
	};
};

export type OcrFailureOptions = {
	attemptCount: number;
	failedAt: Date;
	jitterMs?: number;
};

function randomJitterMs(): number {
	return crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
}

function validateOptions(options: OcrFailureOptions): number {
	if (!Number.isInteger(options.attemptCount) || options.attemptCount < 1) {
		throw new TypeError('OCR attempt count must be a positive integer');
	}
	if (!(options.failedAt instanceof Date) || Number.isNaN(options.failedAt.getTime())) {
		throw new TypeError('OCR failure timestamp must be a valid Date');
	}
	const jitterMs = options.jitterMs ?? randomJitterMs();
	if (!Number.isInteger(jitterMs) || jitterMs < 0 || jitterMs > 999) {
		throw new TypeError('OCR retry jitter must be an integer from 0 to 999 milliseconds');
	}
	return jitterMs;
}

function nextRetryAt(
	failedAt: Date,
	attemptCount: number,
	baseSeconds: number,
	jitterMs: number
): string {
	const exponent = Math.min(Math.max(attemptCount - 1, 0), 6);
	const delayMs = Math.min(60 * 60 * 1000, baseSeconds * 1000 * 2 ** exponent + jitterMs);
	return new Date(failedAt.getTime() + delayMs).toISOString();
}

function frozenDecision(
	persistence: OcrFailurePersistence,
	status: number,
	body: Record<string, unknown>
): OcrFailureDecision {
	return Object.freeze({
		persistence: Object.freeze(persistence),
		response: Object.freeze({ status, body: Object.freeze(body) })
	});
}

export function planOcrFailure(error: unknown, options: OcrFailureOptions): OcrFailureDecision {
	const jitterMs = validateOptions(options);
	const failedAt = options.failedAt.toISOString();

	if (error instanceof GeminiHttpError) {
		const failure = classifyGeminiFailure(error.status, error.responseBody);
		const response = geminiFailureResponse(failure, error.status);
		if (failure.quotaExhausted) {
			return frozenDecision(
				{
					kind: 'block_quota',
					code: failure.code,
					failedAt
				},
				response.status,
				response.body
			);
		}
		return frozenDecision(
			{
				kind: 'fail_job',
				code: failure.code,
				message: failure.safeMessage,
				retryable: failure.retryable,
				failedAt,
				nextRetryAt:
					failure.retryable && failure.delaySeconds
						? nextRetryAt(options.failedAt, options.attemptCount, failure.delaySeconds, jitterMs)
						: null
			},
			response.status,
			response.body
		);
	}

	const retryable = options.attemptCount < 3;
	const responseInvalid = error instanceof GeminiResponseError;
	const requestInterrupted =
		error instanceof GeminiTransportError ||
		(error instanceof DOMException && error.name === 'AbortError');
	const code = responseInvalid ? 'ocr_response_invalid' : 'ocr_request_failed';
	return frozenDecision(
		{
			kind: 'fail_job',
			code,
			message: responseInvalid
				? 'O provedor retornou um formato de transcrição inválido.'
				: requestInterrupted
					? 'A solicitação de leitura foi interrompida.'
					: 'A leitura falhou antes de produzir um resultado válido.',
			retryable,
			failedAt,
			nextRetryAt: retryable
				? nextRetryAt(options.failedAt, options.attemptCount, 45, jitterMs)
				: null
		},
		retryable ? 202 : responseInvalid ? 422 : 503,
		retryable ? { state: 'retry_later' } : { code, retryable: false }
	);
}
