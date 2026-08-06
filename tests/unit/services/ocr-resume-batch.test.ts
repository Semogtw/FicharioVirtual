import { describe, expect, it } from 'vitest';
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
	it('groups resumable pages into serial 40-page calls', async () => {
		const items = pages(85);
		const calls: string[][] = [];
		const result = await resumeDocumentOcrWithGateway(
			documentId,
			gateway(items),
			async () => ({ state: 'busy' }),
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

		expect(calls.map((call) => call.length)).toEqual([40, 40, 5]);
		expect(result).toEqual({ completed: 85, needsReview: 0, pending: 0, failed: 0 });
	});

	it('does not start the next batch after cancellation', async () => {
		const items = pages(45);
		const controller = new AbortController();
		let calls = 0;
		const result = await resumeDocumentOcrWithGateway(
			documentId,
			gateway(items),
			async () => ({ state: 'busy' }),
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
		expect(result).toEqual({ completed: 40, needsReview: 0, pending: 5, failed: 0 });
	});
});
