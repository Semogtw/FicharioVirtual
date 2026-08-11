import { describe, expect, it, vi } from 'vitest';
import {
	resumeDocumentOcrWithGateway,
	type OcrResumeGateway
} from '../../../src/lib/services/ocr-resume';

const documentId = '11111111-1111-4111-8111-111111111111';

function pages(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
		pageNumber: index + 1
	}));
}

function gateway(items: ReturnType<typeof pages>): OcrResumeGateway {
	return {
		async recoverStaleJobs() {},
		async listPendingPages() {
			return items;
		}
	};
}

describe('batched OCR resume', () => {
	it('uses conservative unknown-size batches instead of pretending resumed pages cost one byte', async () => {
		const items = pages(85);
		const calls: string[][] = [];
		const result = await resumeDocumentOcrWithGateway(
			documentId,
			gateway(items),
			async () => ({ state: 'retry_later' }),
			{
				batchProcessor: async (pageIds) => {
					calls.push([...pageIds]);
					return {
						state: 'complete',
						completedPageIds: pageIds,
						reviewPageIds: [],
						pendingPageIds: [],
						failedPageIds: [],
						splitRequiredPageIds: [],
						unexpectedResultPageIds: []
					};
				}
			}
		);

		expect(calls.map((call) => call.length)).toEqual([12, 12, 12, 12, 12, 12, 12, 1]);
		expect(result).toEqual({ completed: 85, needsReview: 0, pending: 0, failed: 0 });
	});

	it('retries only the split-required subset and keeps accepted pages complete', async () => {
		const items = pages(4);
		const calls: string[][] = [];
		const sleep = vi.fn(async () => undefined);
		const result = await resumeDocumentOcrWithGateway(
			documentId,
			gateway(items),
			async () => ({ state: 'retry_later' }),
			{
				sleep,
				batchProcessor: async (pageIds) => {
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
					return {
						state: 'complete',
						completedPageIds: pageIds,
						reviewPageIds: [],
						pendingPageIds: [],
						failedPageIds: [],
						splitRequiredPageIds: [],
						unexpectedResultPageIds: []
					};
				}
			}
		);

		expect(calls[0]).toEqual(items.map((item) => item.id));
		expect(calls.slice(1).flat()).toEqual([items[2]!.id, items[3]!.id]);
		expect(calls.slice(1).flat()).not.toContain(items[0]!.id);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ completed: 4, needsReview: 0, pending: 0, failed: 0 });
	});

	it('does not start the next batch after cancellation', async () => {
		const items = pages(45);
		const controller = new AbortController();
		let calls = 0;
		const result = await resumeDocumentOcrWithGateway(
			documentId,
			gateway(items),
			async () => ({ state: 'retry_later' }),
			{
				signal: controller.signal,
				batchProcessor: async (pageIds) => {
					calls += 1;
					controller.abort();
					return {
						state: 'complete',
						completedPageIds: pageIds,
						reviewPageIds: [],
						pendingPageIds: [],
						failedPageIds: [],
						splitRequiredPageIds: [],
						unexpectedResultPageIds: []
					};
				}
			}
		);

		expect(calls).toBe(1);
		expect(result).toEqual({ completed: 12, needsReview: 0, pending: 33, failed: 0 });
	});
});
