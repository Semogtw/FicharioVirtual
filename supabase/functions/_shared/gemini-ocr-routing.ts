import { GeminiHttpError } from './gemini-ocr-client.ts';

export const DEFAULT_GEMINI_OCR_PRIMARY_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_OCR_FALLBACK_MODEL = 'gemini-3.5-flash-lite';
export const DEFAULT_GEMINI_OCR_RPM = 12;
export const DEFAULT_GEMINI_OCR_MAX_QUEUE_WAIT_MS = 20_000;

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
		this.retryAfterMs = Math.max(1_000, Math.min(60_000, Math.round(retryAfterMs)));
	}
}

export function parseGeminiRateReservation(value: unknown): GeminiRateReservation | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.allowed !== 'boolean') return null;
	if (
		typeof record.waitMs !== 'number' ||
		!Number.isFinite(record.waitMs) ||
		record.waitMs < 0 ||
		record.waitMs > 60_000
	) {
		return null;
	}
	return Object.freeze({
		allowed: record.allowed,
		waitMs: Math.ceil(record.waitMs)
	});
}

/**
 * A 429 that escaped the app-side limiter is eligible for the secondary model.
 * Normal local RPM pressure never reaches this function because it is queued first.
 */
export function shouldFallbackGeminiOcr(error: unknown): boolean {
	return error instanceof GeminiHttpError && error.status === 429;
}

export function retryAtFromRateLimit(failedAt: Date, retryAfterMs: number): string {
	if (!(failedAt instanceof Date) || Number.isNaN(failedAt.getTime())) {
		throw new TypeError('failedAt must be a valid Date');
	}
	const safeDelay = Math.max(1_000, Math.min(60_000, Math.ceil(retryAfterMs)));
	return new Date(failedAt.getTime() + safeDelay).toISOString();
}
