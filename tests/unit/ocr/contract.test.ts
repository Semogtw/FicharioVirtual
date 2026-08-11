import { describe, expect, it } from 'vitest';
import {
	claimStateHttpStatus,
	classifyGeminiFailure,
	parseGeminiProviderErrorMetadata,
	parseOcrClaimState,
	parseOcrPayload
} from '../../../supabase/functions/_shared/ocr-contract';

describe('OCR response contract', () => {
	it('accepts bounded text and normalized warnings', () => {
		expect(
			parseOcrPayload(
				JSON.stringify({
					text: 'Mitose e meiose',
					warnings: [
						{ code: 'uncertain_text', message: 'Uma palavra na margem está pouco legível.' }
					]
				})
		).toEqual({
			text: 'Mitose e meiose',
			warnings: [{ code: 'uncertain_text', message: 'Uma palavra na margem está pouco legível.' }],
			needsReview: true
		});
	});

	it('rejects markdown fences and unbounded unknown payloads', () => {
		expect(() => parseOcrPayload('```json\n{"text":"x","warnings":[]}\n```')).toThrow(
			'Invalid OCR response'
		);
		expect(() =>
			parseOcrPayload(JSON.stringify({ text: 'x', warnings: [], privateReasoning: 'hidden' }))
		).toThrow('Invalid OCR response');
	});
});

describe('OCR claim HTTP mapping', () => {
	describe('claim state parser', () => {
		it.each([
			'claimed',
			'already_complete',
			'busy',
			'retry_later',
			'quota_exhausted',
			'not_authorized',
			'not_found',
			'invalid_configuration',
			'not_retryable'
		])('accepts known claim state %s', (state) => {
			expect(parseOcrClaimState(state)).toBe(state);
		});

		it.each([undefined, null, 1, '', 'unknown', 'CLAIMED', 'consent_required'])(
			'rejects malformed or removed claim state %s',
			(state) => {
				expect(parseOcrClaimState(state)).toBeNull();
			}
		);
	});

	it('keeps expected internal deferred states in successful function responses', () => {
		expect(claimStateHttpStatus('already_complete')).toBe(200);
		expect(claimStateHttpStatus('busy')).toBe(202);
		expect(claimStateHttpStatus('retry_later')).toBe(202);
		expect(claimStateHttpStatus('quota_exhausted')).toBe(202);
	});

	it('uses authorization and lookup errors only for rejected claims', () => {
		expect(claimStateHttpStatus('not_authorized')).toBe(403);
		expect(claimStateHttpStatus('not_found')).toBe(404);
		expect(claimStateHttpStatus('invalid_configuration')).toBe(409);
	});
});

describe('Gemini failure classification', () => {
	it('separates daily quota exhaustion from transient rate limiting', () => {
		expect(classifyGeminiFailure(429, 'Requests per day quota exceeded')).toEqual(
			expect.objectContaining({
				code: 'gemini_daily_quota',
				retryable: false,
				quotaExhausted: true
			})
		);
		expect(classifyGeminiFailure(429, 'Rate limit exceeded')).toEqual(
			expect.objectContaining({
				code: 'gemini_rate_limited',
				retryable: true,
				quotaExhausted: false
			})
		);
	});

	it('recognizes Google API key rejection even when Gemini returns HTTP 400', () => {
		const body = JSON.stringify({
			error: {
				code: 400,
				message: 'secret provider message that must never escape classification',
				status: 'INVALID_ARGUMENT',
				details: [
					{
						'@type': 'type.googleapis.com/google.rpc.ErrorInfo',
						reason: 'API_KEY_INVALID',
						domain: 'googleapis.com',
						metadata: { service: 'generativelanguage.googleapis.com', private: 'secret' }
					}
				]
			}
		});
		expect(parseGeminiProviderErrorMetadata(body)).toEqual({
			status: 'INVALID_ARGUMENT',
			reason: 'API_KEY_INVALID'
		});
		expect(JSON.stringify(parseGeminiProviderErrorMetadata(body))).not.toMatch(
			/secret|message|metadata/i
		);
		expect(classifyGeminiFailure(400, body)).toEqual(
			expect.objectContaining({
				code: 'gemini_authentication_failed',
				retryable: false,
				quotaExhausted: false
			})
		);
	});

	it('discards unknown provider metadata instead of widening the diagnostic surface', () => {
		expect(
			parseGeminiProviderErrorMetadata(
				JSON.stringify({
					error: {
						status: 'SOMETHING_NEW',
						details: [{ reason: 'SENSITIVE_OR_UNKNOWN_REASON' }]
					}
				})
			)
		).toEqual({ status: null, reason: null });
		expect(parseGeminiProviderErrorMetadata('not json')).toEqual({ status: null, reason: null });
	});

	it('retries service failures but not authentication or model errors', () => {
		expect(classifyGeminiFailure(503, 'unavailable').retryable).toBe(true);
		expect(classifyGeminiFailure(403, 'permission denied').retryable).toBe(false);
		expect(classifyGeminiFailure(404, 'model not found')).toEqual(
			expect.objectContaining({ code: 'gemini_model_unavailable', retryable: false })
		);
	});

	it('pins every provider status to its persisted retry and quota policy', () => {
		expect(classifyGeminiFailure(429, 'daily quota requests per day')).toEqual(
			expect.objectContaining({
				code: 'gemini_daily_quota',
				retryable: false,
				quotaExhausted: true,
				delaySeconds: null
			})
		);
		expect(classifyGeminiFailure(429, 'burst rate limit')).toEqual(
			expect.objectContaining({
				code: 'gemini_rate_limited',
				retryable: true,
				quotaExhausted: false,
				delaySeconds: 60
			})
		);
		for (const [status, code] of [
			[401, 'gemini_authentication_failed'],
			[403, 'gemini_authentication_failed'],
			[404, 'gemini_model_unavailable'],
			[400, 'gemini_invalid_request'],
			[422, 'gemini_invalid_request']
		] as const) {
			expect(classifyGeminiFailure(status, '')).toEqual(
				expect.objectContaining({
					code,
					retryable: false,
					quotaExhausted: false,
					delaySeconds: null
				})
			);
		}
		for (const status of [408, 425, 500, 503]) {
			expect(classifyGeminiFailure(status, '')).toEqual(
				expect.objectContaining({
					code: 'gemini_service_unavailable',
					retryable: true,
					quotaExhausted: false,
					delaySeconds: 30
				})
			);
		}
		expect(classifyGeminiFailure(418, '')).toEqual(
			expect.objectContaining({
				code: 'gemini_service_unavailable',
				retryable: false,
				quotaExhausted: false,
				delaySeconds: null
			})
		);
	});
});
