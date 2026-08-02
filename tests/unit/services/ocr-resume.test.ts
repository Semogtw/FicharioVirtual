import { describe, expect, it } from 'vitest';
import {
	resumeDocumentOcrWithGateway,
	type OcrResumeGateway
} from '../../../src/lib/services/ocr-resume';

const documentId = '11111111-1111-4111-8111-111111111111';

function gateway(pages: Array<{ id: string; pageNumber: number }>): OcrResumeGateway {
	return {
		async listPendingPages() {
			return pages;
		}
	};
}

describe('resumeDocumentOcrWithGateway', () => {
	it('retries only pending page identifiers with at most two concurrent calls', async () => {
		const pages = [1, 2, 3, 4].map((pageNumber) => ({
			id: `00000000-0000-4000-8000-00000000000${pageNumber}`,
			pageNumber
		}));
		let active = 0;
		let maximum = 0;
		const processed: number[] = [];

		const result = await resumeDocumentOcrWithGateway(
			documentId,
			gateway(pages),
			async (pageId) => {
				active += 1;
				maximum = Math.max(maximum, active);
				processed.push(Number(pageId.at(-1)));
				await Promise.resolve();
				active -= 1;
				return { state: 'complete', needsReview: false, warningCount: 0 };
			}
		);

		expect(maximum).toBeLessThanOrEqual(2);
		expect(processed.sort()).toEqual([1, 2, 3, 4]);
		expect(result).toEqual({ completed: 4, needsReview: 0, pending: 0, failed: 0 });
	});

	it('keeps retryable and busy results pending without treating them as complete', async () => {
		const pages = [
			{ id: '00000000-0000-4000-8000-000000000001', pageNumber: 1 },
			{ id: '00000000-0000-4000-8000-000000000002', pageNumber: 2 }
		];
		let call = 0;
		const result = await resumeDocumentOcrWithGateway(documentId, gateway(pages), async () => {
			call += 1;
			if (call === 1) return { state: 'busy' };
			throw new Error('temporary failure');
		});

		expect(result).toEqual({ completed: 0, needsReview: 0, pending: 1, failed: 1 });
	});
});
