import { describe, expect, it } from 'vitest';
import {
	claimStateHttpStatus,
	classifyGeminiFailure,
	geminiFailureResponse,
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
			warnings: [
				{ code: 'uncertain_text', message: 'Uma palavra na margem está pouco legível.' }
			],
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
	it('keeps expected deferred states in successful function responses', () => {
		expect(claimStateHttpStatus('already_complete')).toBe(200);
		expect(claimStateHttpStatus('busy')).toBe(202);
		expect(claimStateHttpStatus('retry_later')).toBe(202);
		expect(claimStateHttpStatus('quota_exhausted')).toBe(202);
	});

	it('uses authorization and lookup errors only for rejected claims', () => {
		expect(claimStateHttpStatus('consent_required')).toBe(403);
		expect(claimStateHttpStatus('not_authorized')).toBe(403);
		expect(claimStateHttpStatus('not_found')).toBe(404);
		expect(claimStateHttpStatus('invalid_configuration')).toBe(409);
	});
});

describe('Gemini failure classification', () => {
	it('separates daily quota exhaustion from transient rate limiting', () => {
		expect(classifyGeminiFailure(429, 'Requests per day quota exceeded')).toEqual(
			expect.objectContaining({ code: 'gemini_daily_quota', retryable: false, quotaExhausted: true })
		);
		expect(classifyGeminiFailure(429, 'Rate limit exceeded')).toEqual(
			expect.objectContaining({ code: 'gemini_rate_limited', retryable: true, quotaExhausted: false })
		);
	});

	it('retries service failures but not authentication or model errors', () => {
		expect(classifyGeminiFailure(503, 'unavailable').retryable).toBe(true);
		expect(classifyGeminiFailure(403, 'permission denied').retryable).toBe(false);
		expect(classifyGeminiFailure(404, 'model not found')).toEqual(
			expect.objectContaining({ code: 'gemini_model_unavailable', retryable: false })
		);
	});

	it('returns persisted deferred states as 202 instead of SDK exceptions', () => {
		expect(geminiFailureResponse(classifyGeminiFailure(429, 'Requests per day quota exceeded'), 429)).toEqual({
			status: 202,
			body: { state: 'quota_exhausted' }
		});
		expect(geminiFailureResponse(classifyGeminiFailure(503, 'unavailable'), 503)).toEqual({
			status: 202,
			body: { state: 'retry_later' }
		});
	});

	it('preserves permanent provider failures as HTTP errors', () => {
		expect(geminiFailureResponse(classifyGeminiFailure(403, 'permission denied'), 403)).toEqual({
			status: 403,
			body: { code: 'gemini_authentication_failed', retryable: false }
		});
	});
});
