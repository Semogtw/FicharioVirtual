import { describe, expect, it } from 'vitest';
import { parseOcrBatchPayload } from '../../../supabase/functions/_shared/ocr-batch-contract';

const first = { pageId: '11111111-1111-4111-8111-111111111111', pageNumber: 1 };
const second = { pageId: '22222222-2222-4222-8222-222222222222', pageNumber: 2 };

function result(page = first, text = 'Texto') {
	return { ...page, text, warnings: [] };
}

describe('parseOcrBatchPayload', () => {
	it('accepts the exact requested set and restores request order', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({ pages: [result(second, 'Dois'), result(first, 'Um')] }),
			[first, second]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages.map((page) => [page.pageId, page.text])).toEqual([
			[first.pageId, 'Um'],
			[second.pageId, 'Dois']
		]);
		expect(parsed.missingPageIds).toEqual([]);
	});

	it('keeps valid unique pages while reporting omissions for subset retry', () => {
		const parsed = parseOcrBatchPayload(JSON.stringify({ pages: [result(first)] }), [
			first,
			second
		]);

		expect(parsed.valid).toBe(false);
		expect(parsed.pages.map((page) => page.pageId)).toEqual([first.pageId]);
		expect(parsed.missingPageIds).toEqual([second.pageId]);
		expect(parsed.duplicatePageIds).toEqual([]);
		expect(parsed.unexpectedPageIds).toEqual([]);
	});

	it('does not accept duplicate or unexpected pages as successful results', () => {
		const unexpected = { pageId: '33333333-3333-4333-8333-333333333333', pageNumber: 3 };
		const parsed = parseOcrBatchPayload(
			JSON.stringify({ pages: [result(first), result(first), result(unexpected)] }),
			[first, second]
		);

		expect(parsed.valid).toBe(false);
		expect(parsed.pages).toEqual([]);
		expect(parsed.duplicatePageIds).toEqual([first.pageId]);
		expect(parsed.unexpectedPageIds).toEqual([unexpected.pageId]);
		expect(parsed.missingPageIds).toEqual([second.pageId]);
	});

	it('turns malformed, mismatched or extended provider output into missing-page retry data', () => {
		for (const payload of [
			'{',
			JSON.stringify({ pages: [{ ...result(first), pageNumber: 9 }] }),
			JSON.stringify({ pages: [{ ...result(first), commentary: 'extra' }] })
		]) {
			expect(parseOcrBatchPayload(payload, [first])).toEqual({
				valid: false,
				pages: [],
				missingPageIds: [first.pageId],
				duplicatePageIds: [],
				unexpectedPageIds: []
			});
		}
	});

	it('still rejects an invalid request manifest before provider parsing', () => {
		expect(() => parseOcrBatchPayload('{}', [first, first])).toThrow('Invalid OCR batch request');
	});

	it('derives per-page review state from conservative warnings', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({
				pages: [
					{
						...first,
						text: '',
						warnings: [{ code: 'empty_page', message: 'Não há texto legível.' }]
					}
				]
			}),
			[first]
		);

		expect(parsed.pages[0]).toEqual(
			expect.objectContaining({ needsReview: true, text: '', warnings: expect.any(Array) })
		);
	});
});
