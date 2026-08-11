import { describe, expect, it } from 'vitest';
import {
	bisectOcrBatch,
	planOcrBatches,
	validateOcrBatchResult,
	type OcrBatchPageCandidate
} from '../../../src/lib/ocr/batch-planner';

const MIB = 1024 * 1024;

function page(
	index: number,
	overrides: Partial<OcrBatchPageCandidate> = {}
): OcrBatchPageCandidate {
	const suffix = index.toString(16).padStart(12, '0');
	return {
		pageId: `00000000-0000-4000-8000-${suffix}`,
		pageNumber: index,
		derivedBytes: 200_000,
		density: 'normal',
		route: 'gemini',
		...overrides
	};
}

describe('planOcrBatches', () => {
	it('sorts pages and groups normal documents below the Flash-Lite response budget', () => {
		const pages = Array.from({ length: 85 }, (_, index) => page(85 - index));
		const batches = planOcrBatches(pages, { maxDerivedBytes: 50 * MIB });

		expect(batches.map((batch) => batch.pages.length)).toEqual([28, 28, 28, 1]);
		expect(batches[0]?.pages[0]?.pageNumber).toBe(1);
		expect(batches[3]?.pages.at(-1)?.pageNumber).toBe(85);
		expect(batches.every((batch) => batch.estimatedOutputTokens <= 48_000)).toBe(true);
		expect(batches.every((batch) => batch.route === 'gemini')).toBe(true);
	});

	it('does not mix routes and downsizes batches containing dense pages', () => {
		const batches = planOcrBatches([
			page(1, { density: 'dense' }),
			...Array.from({ length: 24 }, (_, index) => page(index + 2)),
			page(26, { route: 'desktop' }),
			page(27, { route: 'desktop' })
		]);

		expect(batches.map((batch) => [batch.route, batch.pages.length])).toEqual([
			['gemini', 14],
			['gemini', 11],
			['desktop', 2]
		]);
	});

	it('cuts batches before estimated output would exhaust the provider response ceiling', () => {
		const batches = planOcrBatches(
			Array.from({ length: 12 }, (_, index) => page(index + 1)),
			{
				maxPages: 40,
				denseMaxPages: 40,
				maxDerivedBytes: 50 * MIB,
				maxEstimatedOutputTokens: 10_000
			}
		);

		expect(batches.map((batch) => batch.pages.length)).toEqual([5, 5, 2]);
		expect(batches.map((batch) => batch.estimatedOutputTokens)).toEqual([8_500, 8_500, 3_400]);
	});

	it('respects the aggregate derived-byte ceiling without dropping an oversized single page', () => {
		const batches = planOcrBatches(
			[
				page(1, { derivedBytes: 5 * MIB }),
				page(2, { derivedBytes: 5 * MIB }),
				page(3, { derivedBytes: 13 * MIB }),
				page(4, { derivedBytes: 1 * MIB })
			],
			{ maxDerivedBytes: 12 * MIB }
		);

		expect(batches.map((batch) => batch.pages.map((value) => value.pageNumber))).toEqual([
			[1, 2],
			[3],
			[4]
		]);
		expect(batches[1]?.oversizedSinglePage).toBe(true);
		expect(batches.flatMap((batch) => batch.pages)).toHaveLength(4);
	});

	it('rejects duplicate identities, duplicate page numbers and invalid limits', () => {
		expect(() => planOcrBatches([page(1), page(2, { pageId: page(1).pageId })])).toThrow(
			'Duplicate OCR page identifier'
		);
		expect(() => planOcrBatches([page(1), page(2, { pageNumber: 1 })])).toThrow(
			'Duplicate OCR page number'
		);
		expect(() => planOcrBatches([page(1)], { maxPages: 0 })).toThrow('Invalid OCR batch limits');
		expect(() => planOcrBatches([page(1)], { maxEstimatedOutputTokens: 65_537 })).toThrow(
			'Invalid OCR batch limits'
		);
	});
});

describe('bisectOcrBatch', () => {
	it('creates two ordered nonempty children and increments split depth', () => {
		const [left, right] = bisectOcrBatch(planOcrBatches([page(1), page(2), page(3)])[0]!);

		expect(left.pages.map((value) => value.pageNumber)).toEqual([1, 2]);
		expect(right.pages.map((value) => value.pageNumber)).toEqual([3]);
		expect(left.splitDepth).toBe(1);
		expect(right.splitDepth).toBe(1);
		expect(left.parentKey).toBe(right.parentKey);
	});

	it('refuses to split a one-page batch', () => {
		expect(() => bisectOcrBatch(planOcrBatches([page(1)])[0]!)).toThrow(
			'Cannot split a one-page OCR batch'
		);
	});
});

describe('validateOcrBatchResult', () => {
	it('reports missing, duplicate and unexpected result identities independently', () => {
		const requested = [page(1).pageId, page(2).pageId, page(3).pageId];
		const unexpected = page(4).pageId;
		const integrity = validateOcrBatchResult(requested, [requested[0]!, requested[0]!, unexpected]);

		expect(integrity.valid).toBe(false);
		expect(integrity.missingPageIds).toEqual([requested[1], requested[2]]);
		expect(integrity.duplicatePageIds).toEqual([requested[0]]);
		expect(integrity.unexpectedPageIds).toEqual([unexpected]);
	});

	it('accepts the exact requested set regardless of provider order', () => {
		const requested = [page(1).pageId, page(2).pageId];
		expect(validateOcrBatchResult(requested, [...requested].reverse())).toEqual({
			valid: true,
			missingPageIds: [],
			duplicatePageIds: [],
			unexpectedPageIds: []
		});
	});
});
