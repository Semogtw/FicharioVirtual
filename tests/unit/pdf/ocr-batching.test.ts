import { describe, expect, it, vi } from 'vitest';
import { runPdfOcrBatches } from '../../../src/lib/pdf/ocr-batching';

function page(index: number, bytes = 100_000) {
	return {
		id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
		pageNumber: index,
		derivedBytes: bytes,
		density: 'normal' as const
	};
}

function complete(ids: readonly string[], review: readonly string[] = []) {
	return {
		state: 'complete' as const,
		completedPageIds: ids,
		reviewPageIds: review,
		pendingPageIds: [],
		failedPageIds: [],
		splitRequiredPageIds: [],
		unexpectedResultPageIds: []
	};
}

describe('runPdfOcrBatches', () => {
	it('uses fewer provider calls than pages and preserves review counts', async () => {
		const pages = Array.from({ length: 45 }, (_, index) => page(index + 1));
		const calls: string[][] = [];
		const result = await runPdfOcrBatches({
			pages,
			async processBatch(pageIds) {
				calls.push([...pageIds]);
				return complete(pageIds, pageIds.slice(0, 1));
			}
		});

		expect(calls.map((call) => call.length)).toEqual([28, 17]);
		expect(result.complete).toBe(43);
		expect(result.needsReview).toBe(2);
		expect(result.pending).toBe(0);
		expect(result.failed).toBe(0);
	});

	it('bisects only the subset explicitly marked for split and never repeats successful pages', async () => {
		const pages = [page(1), page(2), page(3), page(4)];
		const calls: string[][] = [];
		const sleep = vi.fn(async () => undefined);
		const result = await runPdfOcrBatches({
			pages,
			sleep,
			async processBatch(pageIds) {
				calls.push([...pageIds]);
				if (calls.length === 1) {
					return {
						state: 'partial',
						completedPageIds: pageIds.slice(0, 2),
						reviewPageIds: [],
						pendingPageIds: pageIds.slice(2),
						failedPageIds: [],
						splitRequiredPageIds: pageIds.slice(2),
						unexpectedResultPageIds: []
					};
				}
				return complete(pageIds);
			}
		});

		expect(calls[0]).toEqual(pages.map((value) => value.id));
		expect(calls.slice(1).flat()).toEqual([pages[2]!.id, pages[3]!.id]);
		expect(calls.slice(1).flat()).not.toContain(pages[0]!.id);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ complete: 4, needsReview: 0, pending: 0, failed: 0 });
	});

	it('keeps a malformed isolated page pending without retrying the same indivisible batch', async () => {
		const onlyPage = page(1);
		const processBatch = vi.fn(async (pageIds: readonly string[]) => ({
			state: 'partial' as const,
			completedPageIds: [],
			reviewPageIds: [],
			pendingPageIds: pageIds,
			failedPageIds: [],
			splitRequiredPageIds: pageIds,
			unexpectedResultPageIds: []
		}));
		const sleep = vi.fn(async () => undefined);

		await expect(runPdfOcrBatches({ pages: [onlyPage], processBatch, sleep })).resolves.toEqual({
			complete: 0,
			needsReview: 0,
			pending: 1,
			failed: 0
		});
		expect(processBatch).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('leaves untouched pages pending after cancellation instead of starting another batch', async () => {
		const controller = new AbortController();
		const pages = Array.from({ length: 45 }, (_, index) => page(index + 1));
		let calls = 0;
		const result = await runPdfOcrBatches({
			pages,
			signal: controller.signal,
			async processBatch(pageIds) {
				calls += 1;
				controller.abort();
				return complete(pageIds);
			}
		});

		expect(calls).toBe(1);
		expect(result.complete).toBe(28);
		expect(result.pending).toBe(17);
	});
});
