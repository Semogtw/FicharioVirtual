import { describe, expect, it } from 'vitest';
import { parseDocumentOcrSummary } from '$lib/services/ocr-summary';

describe('document OCR summary', () => {
	it('parses a complete aggregate', () => {
		expect(
			parseDocumentOcrSummary([{ total: 8, completed: 5, needs_review: 1, pending: 2, failed: 0 }])
		).toEqual({ total: 8, completed: 5, needsReview: 1, pending: 2, failed: 0 });
	});

	it('rejects aggregates whose buckets do not match the total', () => {
		expect(() =>
			parseDocumentOcrSummary([{ total: 8, completed: 5, needs_review: 1, pending: 1, failed: 0 }])
		).toThrow(TypeError);
	});

	it('rejects unexpected fields and negative counters', () => {
		expect(() =>
			parseDocumentOcrSummary([
				{ total: 1, completed: 1, needs_review: 0, pending: 0, failed: 0, extra: true }
			])
		).toThrow(TypeError);
		expect(() =>
			parseDocumentOcrSummary([{ total: 1, completed: 0, needs_review: 0, pending: 2, failed: -1 }])
		).toThrow(TypeError);
	});
});
