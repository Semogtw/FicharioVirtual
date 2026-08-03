import { describe, expect, it } from 'vitest';
import { OcrProcessingError } from '../../../src/lib/services/ocr';
import {
	parsePendingOcrPages,
	resumeDocumentOcrWithGateway,
	type OcrResumeGateway
} from '../../../src/lib/services/ocr-resume';

const documentId = '11111111-1111-4111-8111-111111111111';

function gateway(
	pages: Array<{ id: string; pageNumber: number }>,
	events: string[] = []
): OcrResumeGateway {
	return {
		async recoverStaleJobs() {
			events.push('recover');
		},
		async listPendingPages() {
			events.push('list');
			return pages;
		}
	};
}

describe('resumeDocumentOcrWithGateway', () => {
	it('recovers interrupted claims before selecting resumable pages', async () => {
		const events: string[] = [];

		await resumeDocumentOcrWithGateway(documentId, gateway([], events));

		expect(events).toEqual(['recover', 'list']);
	});

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
			throw new Error('terminal failure');
		});

		expect(result).toEqual({ completed: 0, needsReview: 0, pending: 1, failed: 1 });
	});

	it('keeps retryable OCR processing errors pending for a later resume', async () => {
		const pages = [{ id: '00000000-0000-4000-8000-000000000001', pageNumber: 1 }];

		const result = await resumeDocumentOcrWithGateway(documentId, gateway(pages), async () => {
			throw new OcrProcessingError('ocr_transport_failed', true);
		});

		expect(result).toEqual({ completed: 0, needsReview: 0, pending: 1, failed: 0 });
	});
});

describe('parsePendingOcrPages', () => {
	it('accepts and freezes exact resumable page rows', () => {
		const result = parsePendingOcrPages([
			{ page_id: '00000000-0000-4000-8000-000000000001', page_number: 1 },
			{ page_id: '00000000-0000-4000-8000-000000000002', page_number: 2 }
		]);

		expect(result).toEqual([
			{ id: '00000000-0000-4000-8000-000000000001', pageNumber: 1 },
			{ id: '00000000-0000-4000-8000-000000000002', pageNumber: 2 }
		]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(result.every(Object.isFrozen)).toBe(true);
	});

	it('rejects malformed, extra or duplicate resumable page rows', () => {
		expect(() => parsePendingOcrPages(null)).toThrow('Invalid resumable OCR page response');
		expect(() =>
			parsePendingOcrPages([
				{ page_id: 'bad-id', page_number: 1 },
				{ page_id: '00000000-0000-4000-8000-000000000002', page_number: 2 }
			])
		).toThrow('Invalid resumable OCR page response');
		expect(() =>
			parsePendingOcrPages([
				{
					page_id: '00000000-0000-4000-8000-000000000001',
					page_number: 1,
					status: 'pending'
				}
			])
		).toThrow('Invalid resumable OCR page response');
		expect(() =>
			parsePendingOcrPages([
				{ page_id: '00000000-0000-4000-8000-000000000001', page_number: 1 },
				{ page_id: '00000000-0000-4000-8000-000000000001', page_number: 2 }
			])
		).toThrow('Invalid resumable OCR page response');
	});
});
