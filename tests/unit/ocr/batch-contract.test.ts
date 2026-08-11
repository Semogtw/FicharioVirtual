import { describe, expect, it } from 'vitest';
import { parseOcrBatchPayload } from '../../../supabase/functions/_shared/ocr-batch-contract';

const first = { pageId: '11111111-1111-4111-8111-111111111111', pageNumber: 1 };
const second = { pageId: '22222222-2222-4222-8222-222222222222', pageNumber: 2 };

function result(page = first, text = 'Texto') {
	return { ...page, text, warnings: [], contentClass: 'unknown', wordGeometry: [] };
}

describe('parseOcrBatchPayload', () => {
	it('accepts the exact launch contract and restores request order', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({ pages: [result(second, 'Dois'), result(first, 'Um')] }),
			[first, second]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages.map((page) => [page.pageId, page.text])).toEqual([
			[first.pageId, 'Um'],
			[second.pageId, 'Dois']
		]);
		expect(parsed.pages.every((page) => page.contentClass === 'unknown')).toBe(true);
		expect(parsed.pages.every((page) => page.wordGeometry.length === 0)).toBe(true);
		expect(parsed.missingPageIds).toEqual([]);
	});

	it('accepts and preserves a closed telemetry content class without changing OCR text', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({
				pages: [{ ...result(first, 'Literal'), contentClass: 'handwriting' }]
			}),
			[first]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages[0]).toMatchObject({
			pageId: first.pageId,
			text: 'Literal',
			contentClass: 'handwriting'
		});
	});

	it('parses compact normalized word geometry and ignores unsafe individual boxes', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({
				pages: [
					{
						...result(first, 'A fotossintcse ocorre.'),
						contentClass: 'scan_degraded',
						wordGeometry: [
							'1200,2400,3500,2900|fotossintcse',
							'9000,100,10001,500|fora',
							'não é uma caixa'
						]
					}
				]
			}),
			[first]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages[0]?.wordGeometry).toEqual([['fotossintcse', 1200, 2400, 3500, 2900]]);
	});

	it('drops a geometrically valid provider box when its word is absent from the OCR transcription', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({
				pages: [
					{
						...result(first, 'A fotossintcse ocorre.'),
						contentClass: 'scan_degraded',
						wordGeometry: ['1200,2400,3500,2900|fotossintcse', '4000,2400,5200,2900|inventada']
					}
				]
			}),
			[first]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages[0]?.wordGeometry).toEqual([['fotossintcse', 1200, 2400, 3500, 2900]]);
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

	it('rejects malformed, mismatched, pre-launch, invalid-class or extended provider output', () => {
		for (const payload of [
			'{',
			JSON.stringify({ pages: [{ ...result(first), pageNumber: 9 }] }),
			JSON.stringify({ pages: [{ ...first, text: 'Texto', warnings: [] }] }),
			JSON.stringify({
				pages: [{ ...first, text: 'Texto', warnings: [], contentClass: 'unknown' }]
			}),
			JSON.stringify({
				pages: [{ ...first, text: 'Texto', warnings: [], wordGeometry: [] }]
			}),
			JSON.stringify({ pages: [{ ...result(first), contentClass: 'not_a_class' }] }),
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

	it('rejects request and response page counts beyond the runtime ceiling', () => {
		const oversizedRequest = Array.from({ length: 101 }, (_, index) => ({
			pageId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`,
			pageNumber: index + 1
		}));
		expect(() => parseOcrBatchPayload('{"pages":[]}', oversizedRequest)).toThrow(
			'Invalid OCR batch request'
		);

		const oversizedResponse = Array.from({ length: 101 }, () => result(first));
		expect(parseOcrBatchPayload(JSON.stringify({ pages: oversizedResponse }), [first])).toEqual({
			valid: false,
			pages: [],
			missingPageIds: [first.pageId],
			duplicatePageIds: [],
			unexpectedPageIds: []
		});
	});

	it('derives per-page review state from conservative warnings', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({
				pages: [
					{
						...result(first, ''),
						warnings: [{ code: 'empty_page', message: 'Não há texto legível.' }]
					}
				]
			}),
			[first]
		);

		expect(parsed.pages[0]).toEqual(
			expect.objectContaining({
				needsReview: true,
				text: '',
				contentClass: 'unknown',
				wordGeometry: [],
				warnings: expect.any(Array)
			})
		);
	});
});
