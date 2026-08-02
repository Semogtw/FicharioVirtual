import { describe, expect, it } from 'vitest';
import {
	classifyGeminiFailure,
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
			)
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
});
