import { describe, expect, it } from 'vitest';
import {
	listRunnableOcrJobsWithGateway,
	parseRunnableOcrJobs,
	type OcrJobsGateway
} from '../../../src/lib/services/jobs';

const selectionAt = '2026-08-04T17:00:00.000Z';

function gateway(rows: unknown, events: string[] = []): OcrJobsGateway {
	return {
		async recoverStaleJobs() {
			events.push('recover');
		},
		async listRunnableJobs(receivedSelectionAt, limit) {
			events.push(`list:${receivedSelectionAt}:${limit}`);
			return rows;
		}
	};
}

describe('parseRunnableOcrJobs', () => {
	it('accepts exact rows and freezes the public result', () => {
		const result = parseRunnableOcrJobs([
			{ page_id: '11111111-1111-4111-8111-111111111111', attempt_count: 0 },
			{ page_id: '22222222-2222-4222-8222-222222222222', attempt_count: 2 }
		]);

		expect(result).toEqual([
			{ pageId: '11111111-1111-4111-8111-111111111111', attemptCount: 0 },
			{ pageId: '22222222-2222-4222-8222-222222222222', attemptCount: 2 }
		]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(result.every(Object.isFrozen)).toBe(true);
	});

	it('rejects malformed, duplicate or over-attempted rows', () => {
		expect(() => parseRunnableOcrJobs(null)).toThrow('Invalid runnable OCR response');
		expect(() =>
			parseRunnableOcrJobs([
				{ page_id: 'bad-id', attempt_count: 0 },
				{ page_id: '22222222-2222-4222-8222-222222222222', attempt_count: 0 }
			])
		).toThrow('Invalid runnable OCR response');
		expect(() =>
			parseRunnableOcrJobs([
				{ page_id: '11111111-1111-4111-8111-111111111111', attempt_count: 3 }
			])
		).toThrow('Invalid runnable OCR response');
		expect(() =>
			parseRunnableOcrJobs([
				{ page_id: '11111111-1111-4111-8111-111111111111', attempt_count: 0 },
				{ page_id: '11111111-1111-4111-8111-111111111111', attempt_count: 1 }
			])
		).toThrow('Invalid runnable OCR response');
		expect(() =>
			parseRunnableOcrJobs([
				{
					page_id: '11111111-1111-4111-8111-111111111111',
					attempt_count: 0,
					status: 'pending'
				}
			])
		).toThrow('Invalid runnable OCR response');
	});
});

describe('listRunnableOcrJobsWithGateway', () => {
	it('recovers stale claims before selecting due work', async () => {
		const events: string[] = [];
		const result = await listRunnableOcrJobsWithGateway(
			gateway(
				[{ page_id: '11111111-1111-4111-8111-111111111111', attempt_count: 1 }],
				events
			),
			{ selectionAt, limit: 25 }
		);

		expect(result).toEqual([
			{ pageId: '11111111-1111-4111-8111-111111111111', attemptCount: 1 }
		]);
		expect(events).toEqual(['recover', `list:${selectionAt}:25`]);
	});

	it('rejects invalid selection timestamps and limits before using the gateway', async () => {
		const events: string[] = [];
		await expect(
			listRunnableOcrJobsWithGateway(gateway([], events), {
				selectionAt: 'not-a-date',
				limit: 25
			})
		).rejects.toThrow(TypeError);
		await expect(
			listRunnableOcrJobsWithGateway(gateway([], events), { selectionAt, limit: 101 })
		).rejects.toThrow(TypeError);
		expect(events).toEqual([]);
	});
});
