import { describe, expect, it } from 'vitest';
import { GeminiHttpError } from '../../../supabase/functions/_shared/gemini-ocr-client.ts';
import {
	DEFAULT_GEMINI_OCR_FALLBACK_MODEL,
	DEFAULT_GEMINI_OCR_MAX_QUEUE_WAIT_MS,
	DEFAULT_GEMINI_OCR_PRIMARY_MODEL,
	DEFAULT_GEMINI_OCR_RPM,
	LocalOcrProviderRateLimitError,
	parseGeminiRateReservation,
	retryAtFromRateLimit,
	shouldFallbackGeminiOcr
} from '../../../supabase/functions/_shared/gemini-ocr-routing.ts';

describe('Gemini OCR routing', () => {
	it('uses 3.1 Flash-Lite as primary and 3.5 Flash-Lite as fallback', () => {
		expect(DEFAULT_GEMINI_OCR_PRIMARY_MODEL).toBe('gemini-3.1-flash-lite');
		expect(DEFAULT_GEMINI_OCR_FALLBACK_MODEL).toBe('gemini-3.5-flash-lite');
		expect(DEFAULT_GEMINI_OCR_RPM).toBe(12);
		expect(DEFAULT_GEMINI_OCR_MAX_QUEUE_WAIT_MS).toBe(20_000);
	});

	it('falls back only for a provider 429, not normal transport or server failures', () => {
		expect(shouldFallbackGeminiOcr(new GeminiHttpError(429, '{}'))).toBe(true);
		expect(shouldFallbackGeminiOcr(new GeminiHttpError(503, '{}'))).toBe(false);
		expect(shouldFallbackGeminiOcr(new Error('network'))).toBe(false);
	});

	it('parses bounded distributed rate reservations', () => {
		expect(parseGeminiRateReservation({ allowed: true, waitMs: 4999.2 })).toEqual({
			allowed: true,
			waitMs: 5000
		});
		expect(parseGeminiRateReservation({ allowed: false, waitMs: 20_001 })).toEqual({
			allowed: false,
			waitMs: 20_001
		});
		expect(parseGeminiRateReservation({ allowed: true, waitMs: -1 })).toBeNull();
		expect(parseGeminiRateReservation({ allowed: 'yes', waitMs: 0 })).toBeNull();
	});

	it('keeps local queue retries bounded and separate from provider fallback', () => {
		const error = new LocalOcrProviderRateLimitError('local_queue_full', 75_000);
		expect(error.retryAfterMs).toBe(60_000);
		expect(shouldFallbackGeminiOcr(error)).toBe(false);
		expect(retryAtFromRateLimit(new Date('2026-08-11T12:00:00.000Z'), 5000)).toBe(
			'2026-08-11T12:00:05.000Z'
		);
	});
});
