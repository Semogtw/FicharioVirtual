import { GeminiHttpError } from './gemini-ocr-client.ts';

export const DEFAULT_GEMINI_OCR_PRIMARY_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_OCR_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_GEMINI_OCR_RPM = 12;
export const DEFAULT_GEMINI_OCR_MAX_QUEUE_WAIT_MS = 20_000;

const MAX_GEMINI_OCR_DEFER_MS = 48 * 60 * 60 * 1000;
const LOCAL_RPM_RETRY_CEILING_MS = 60_000;

export type GeminiRateReservation = Readonly<{
	allowed: boolean;
	waitMs: number;
}>;

export class LocalOcrProviderRateLimitError extends Error {
	readonly retryAfterMs: number;
	readonly reason: 'rate_limiter_unavailable' | 'local_queue_full';

	constructor(reason: 'rate_limiter_unavailable' | 'local_queue_full', retryAfterMs: number) {
		super(
			reason === 'local_queue_full'
				? 'The local OCR provider queue is full.'
				: 'The local OCR provider rate limiter is unavailable.'
		);
		this.name = 'LocalOcrProviderRateLimitError';
		this.reason = reason;
		this.retryAfterMs = Math.max(
			1_000,
			Math.min(MAX_GEMINI_OCR_DEFER_MS, Math.round(retryAfterMs))
		);
	}
}

export function parseGeminiRateReservation(value: unknown): GeminiRateReservation | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.allowed !== 'boolean') return null;
	const maxWaitMs = record.allowed ? LOCAL_RPM_RETRY_CEILING_MS : MAX_GEMINI_OCR_DEFER_MS;
	if (
		typeof record.waitMs !== 'number' ||
		!Number.isFinite(record.waitMs) ||
		record.waitMs < 0 ||
		record.waitMs > maxWaitMs
	) {
		return null;
	}
	return Object.freeze({
		allowed: record.allowed,
		waitMs: Math.ceil(record.waitMs)
	});
}

/**
 * Provider 429s remain eligible for the secondary model. A denied local reservation
 * is also eligible only when its delay is longer than normal RPM pressure, which is
 * how the shared limiter signals that the primary model's daily budget is closed.
 * Short local queue pressure stays on the primary model and is retried instead of
 * burning fallback RPD.
 */
export function shouldFallbackGeminiOcr(error: unknown): boolean {
	if (error instanceof GeminiHttpError) return error.status === 429;
	return (
		error instanceof LocalOcrProviderRateLimitError &&
		error.reason === 'local_queue_full' &&
		error.retryAfterMs > LOCAL_RPM_RETRY_CEILING_MS
	);
}

export function retryAtFromRateLimit(failedAt: Date, retryAfterMs: number): string {
	if (!(failedAt instanceof Date) || Number.isNaN(failedAt.getTime())) {
		throw new TypeError('failedAt must be a valid Date');
	}
	const safeDelay = Math.max(1_000, Math.min(MAX_GEMINI_OCR_DEFER_MS, Math.ceil(retryAfterMs)));
	return new Date(failedAt.getTime() + safeDelay).toISOString();
}
