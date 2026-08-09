import { describe, expect, it } from 'vitest';
import {
	GeminiHttpError,
	GeminiResponseError,
	GeminiTransportError
} from '../../../supabase/functions/_shared/gemini-ocr-client';
import {
	parseOcrAttemptCount,
	planOcrFailure
} from '../../../supabase/functions/_shared/ocr-failure';

describe('parseOcrAttemptCount', () => {
	it.each([1, 2, 99])('accepts positive integer %s', (value) => {
		expect(parseOcrAttemptCount(value)).toBe(value);
	});

	it.each([undefined, null, '1', '', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects non-contract value %s',
		(value) => {
			expect(parseOcrAttemptCount(value)).toBeNull();
		}
	);
});

const failedAt = new Date('2026-08-03T00:00:00.000Z');

describe('planOcrFailure', () => {
	it('separates daily quota from transient provider rate limiting', () => {
		expect(
			planOcrFailure(new GeminiHttpError(429, 'Requests per day quota exceeded'), {
				attemptCount: 1,
				failedAt,
				jitterMs: 0
			})
		).toEqual({
			persistence: {
				kind: 'block_quota',
				code: 'gemini_daily_quota',
				failedAt: failedAt.toISOString()
			},
			response: { status: 202, body: { state: 'quota_exhausted' } }
		});

		expect(
			planOcrFailure(new GeminiHttpError(429, 'Rate limit exceeded'), {
				attemptCount: 1,
				failedAt,
				jitterMs: 0
			})
		).toEqual({
			persistence: {
				kind: 'fail_job',
				code: 'gemini_rate_limited',
				message: 'O provedor limitou temporariamente as solicitações.',
				retryable: true,
				failedAt: failedAt.toISOString(),
				nextRetryAt: '2026-08-03T00:01:00.000Z'
			},
			response: { status: 202, body: { state: 'retry_later' } }
		});
	});

	it('keeps an API key rejection carried by HTTP 400 terminal and non-sensitive', () => {
		const decision = planOcrFailure(
			new GeminiHttpError(
				400,
				JSON.stringify({
					error: {
						status: 'INVALID_ARGUMENT',
						message: 'private provider message',
						details: [{ reason: 'API_KEY_INVALID', metadata: { private: 'value' } }]
					}
				})
			),
			{ attemptCount: 1, failedAt, jitterMs: 0 }
		);

		expect(decision).toEqual({
			persistence: {
				kind: 'fail_job',
				code: 'gemini_authentication_failed',
				message: 'A configuração do provedor de leitura foi rejeitada.',
				retryable: false,
				failedAt: failedAt.toISOString(),
				nextRetryAt: null
			},
			response: {
				status: 400,
				body: { code: 'gemini_authentication_failed', retryable: false }
			}
		});
		expect(JSON.stringify(decision)).not.toMatch(/private provider|metadata|private.*value/i);
	});

	it('maps provider outages to a 30-second retry base', () => {
		const decision = planOcrFailure(new GeminiHttpError(503, 'Unavailable'), {
			attemptCount: 2,
			failedAt,
			jitterMs: 0
		});

		expect(decision.persistence).toEqual(
			expect.objectContaining({
				kind: 'fail_job',
				code: 'gemini_service_unavailable',
				retryable: true,
				nextRetryAt: '2026-08-03T00:01:00.000Z'
			})
		);
		expect(decision.response).toEqual({ status: 202, body: { state: 'retry_later' } });
	});

	it('stops retrying invalid responses after the third attempt', () => {
		const first = planOcrFailure(new GeminiResponseError(), {
			attemptCount: 1,
			failedAt,
			jitterMs: 0
		});
		const third = planOcrFailure(new GeminiResponseError(), {
			attemptCount: 3,
			failedAt,
			jitterMs: 0
		});

		expect(first.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_response_invalid',
				retryable: true,
				nextRetryAt: '2026-08-03T00:00:45.000Z'
			})
		);
		expect(first.response).toEqual({ status: 202, body: { state: 'retry_later' } });
		expect(third.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_response_invalid',
				retryable: false,
				nextRetryAt: null
			})
		);
		expect(third.response).toEqual({
			status: 422,
			body: { code: 'ocr_response_invalid', retryable: false }
		});
	});

	it('stops retrying interrupted requests after the third attempt', () => {
		const first = planOcrFailure(new GeminiTransportError(), {
			attemptCount: 1,
			failedAt,
			jitterMs: 0
		});
		const third = planOcrFailure(new DOMException('aborted', 'AbortError'), {
			attemptCount: 3,
			failedAt,
			jitterMs: 0
		});

		expect(first.persistence).toEqual(
			expect.objectContaining({
				code: 'ocr_request_failed',
				message: 'A solicitação de leitura foi interrompida.',
				retryable: true,
				nextRetryAt: '2026-08-03T00:00:45.000Z'
			})
		);
		expect(third.response).toEqual({
			status: 503,
			body: { code: 'ocr_request_failed', retryable: false }
		});
	});

	it('rejects invalid planning inputs', () => {
		expect(() =>
			planOcrFailure(new Error('failure'), {
				attemptCount: 0,
				failedAt,
				jitterMs: 0
			})
		).toThrow(/attempt count/);
		expect(() =>
			planOcrFailure(new Error('failure'), {
				attemptCount: 1,
				failedAt,
				jitterMs: 1000
			})
		).toThrow(/jitter/);
	});
});
