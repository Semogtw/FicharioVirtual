import { describe, expect, it } from 'vitest';
import { parseOcrBatchPayload } from '../../../supabase/functions/_shared/ocr-batch-contract';

const first = { pageId: '11111111-1111-4111-8111-111111111111', pageNumber: 1 };
const second = { pageId: '22222222-2222-4222-8222-222222222222', pageNumber: 2 };

function result(
	page = first,
	text = 'Texto',
	overrides: Record<string, unknown> = {}
) {
	return {
		...page,
		text,
		contentClass: 'unknown',
		lineGeometry: text.trim() ? ['100,100,900,200'] : [],
		warnings: [],
		...overrides
	};
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
		expect(parsed.pages.every((page) => page.contentClass === 'unknown')).toBe(true);
		expect(parsed.missingPageIds).toEqual([]);
	});

	it('preserves a closed telemetry content class without changing OCR text', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({ pages: [result(first, 'Literal', { contentClass: 'handwriting' })] }),
			[first]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages[0]).toMatchObject({
			pageId: first.pageId,
			text: 'Literal',
			contentClass: 'handwriting'
		});
	});

	it('derives word boxes locally from one compact provider box per non-empty line', () => {
		const parsed = parseOcrBatchPayload(
			JSON.stringify({
				pages: [
					result(first, 'A fotossintese ocorre.\nSegunda linha', {
						contentClass: 'scan_degraded',
						lineGeometry: ['100,200,600,260', '120,300,520,360']
					})
				]
			}),
			[first]
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.pages[0]?.wordGeometry.map((box) => box[0])).toEqual([
			'A',
			'fotossintese',
			'ocorre.',
			'Segunda',
			'linha'
		]);
		expect(parsed.pages[0]?.wordGeometry[0]).toEqual(expect.arrayContaining(['A', 2000, 2600]));
		expect(parsed.pages[0]?.wordGeometry[3]).toEqual(expect.arrayContaining(['Segunda', 3000, 3600]));
	});

	it('keeps OCR text valid but drops geometry when line boxes are malformed or misaligned', () => {
		for (const lineGeometry of [
			['100,100,900,200'],
			['100,100,1001,200', '100,300,900,400'],
			['não-é-caixa', '100,300,900,400']
		]) {
			const parsed = parseOcrBatchPayload(
				JSON.stringify({
					pages: [result(first, 'Primeira linha\nSegunda linha', { lineGeometry })]
				}),
				[first]
			);
			expect(parsed.valid).toBe(true);
			expect(parsed.pages[0]?.text).toBe('Primeira linha\nSegunda linha');
			expect(parsed.pages[0]?.wordGeometry).toEqual([]);
		}
	});

	it('keeps valid unique pages while reporting omissions for subset retry', () => {
		const parsed = parseOcrBatchPayload(JSON.stringify({ pages: [result(first)] }), [first, second]);

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

	it('turns malformed, mismatched, invalid-class or extended provider output into retry data', () => {
		for (const payload of [
			'{',
			JSON.stringify({ pages: [{ ...result(first), pageNumber: 9 }] }),
			JSON.stringify({ pages: [result(first, 'Texto', { contentClass: 'not_a_class' })] }),
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
					result(first, '', {
						lineGeometry: [],
						warnings: [{ code: 'empty_page', message: 'Não há texto legível.' }]
					})
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
