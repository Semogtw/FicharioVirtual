import { classifyGeminiFailure } from './ocr-contract.ts';
import { GeminiHttpError, GeminiResponseError, GeminiTransportError } from './gemini-ocr-client.ts';
import { randomJitterMs } from './random-jitter.ts';

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
};

export type OcrFailureOptions = {
	attemptCount: number;
	failedAt: Date;
	jitterMs?: number;
};

export function parseOcrAttemptCount(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function validateOptions(options: OcrFailureOptions): number {
	if (parseOcrAttemptCount(options.attemptCount) === null) {
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

function frozenDecision(persistence: OcrFailurePersistence): OcrFailureDecision {
	return Object.freeze({ persistence: Object.freeze(persistence) });
}

export function planOcrFailure(error: unknown, options: OcrFailureOptions): OcrFailureDecision {
	const jitterMs = validateOptions(options);
	const failedAt = options.failedAt.toISOString();

	if (error instanceof GeminiHttpError) {
		const failure = classifyGeminiFailure(error.status, error.responseBody);
		if (failure.quotaExhausted) {
			return frozenDecision({
				kind: 'block_quota',
				code: failure.code,
				failedAt
			});
		}
		return frozenDecision({
			kind: 'fail_job',
			code: failure.code,
			message: failure.safeMessage,
			retryable: failure.retryable,
			failedAt,
			nextRetryAt:
				failure.retryable && failure.delaySeconds
					? nextRetryAt(options.failedAt, options.attemptCount, failure.delaySeconds, jitterMs)
					: null
		});
	}

	const retryable = options.attemptCount < 3;
	const responseInvalid = error instanceof GeminiResponseError;
	const requestInterrupted =
		error instanceof GeminiTransportError ||
		(error instanceof DOMException && error.name === 'AbortError');
	const code = responseInvalid ? 'ocr_response_invalid' : 'ocr_request_failed';
	return frozenDecision({
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
	});
}
