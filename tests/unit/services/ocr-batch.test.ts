import { describe, expect, it, vi } from 'vitest';
import { processOcrBatch, type OcrFunctionClient } from '../../../src/lib/services/ocr';

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

function client(data: unknown, error: null | { context?: unknown; message?: string } = null) {
	const invoke = vi.fn().mockResolvedValue({ data, error });
	return { gateway: { functions: { invoke } } as OcrFunctionClient, invoke };
}

describe('processOcrBatch', () => {
	it('sends an exact immutable page list and accepts an exact aggregate result', async () => {
		const fixture = client({
			state: 'complete',
			completedPageIds: [first, second],
			reviewPageIds: [second],
			pendingPageIds: [],
			failedPageIds: [],
			splitRequiredPageIds: [],
			unexpectedResultPageIds: []
		});

		await expect(processOcrBatch([first, second], fixture.gateway)).resolves.toEqual({
			state: 'complete',
			completedPageIds: [first, second],
			reviewPageIds: [second],
			pendingPageIds: [],
			failedPageIds: [],
			splitRequiredPageIds: [],
			unexpectedResultPageIds: []
		});
		expect(fixture.invoke).toHaveBeenCalledWith('process-ocr', {
			body: { pageIds: [first, second] },
			signal: undefined
		});
	});

	it('forwards an explicit persisted batch identity', async () => {
		const batchId = '33333333-3333-4333-8333-333333333333';
		const fixture = client({
			state: 'partial',
			completedPageIds: [first],
			reviewPageIds: [],
			pendingPageIds: [second],
			failedPageIds: [],
			splitRequiredPageIds: [second],
			unexpectedResultPageIds: []
		});

		await processOcrBatch([first, second], fixture.gateway, { batchId });
		expect(fixture.invoke).toHaveBeenCalledWith('process-ocr', {
			body: { pageIds: [first, second], batchId },
			signal: undefined
		});
	});

	it('rejects duplicate inputs and aggregates that lose or overlap requested pages', async () => {
		await expect(processOcrBatch([first, first], client(null).gateway)).rejects.toThrow(
			'Invalid page identifiers'
		);
		await expect(
			processOcrBatch(
				[first, second],
				client({
					state: 'partial',
					completedPageIds: [first],
					reviewPageIds: [],
					pendingPageIds: [],
					failedPageIds: [],
					splitRequiredPageIds: [],
					unexpectedResultPageIds: []
				}).gateway
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_response_invalid' }));
		await expect(
			processOcrBatch(
				[first, second],
				client({
					state: 'partial',
					completedPageIds: [first],
					reviewPageIds: [],
					pendingPageIds: [first, second],
					failedPageIds: [],
					splitRequiredPageIds: [second],
					unexpectedResultPageIds: []
				}).gateway
			)
		).rejects.toEqual(expect.objectContaining({ code: 'ocr_response_invalid' }));
	});

	it('preserves cancellation and distinguishes temporary from daily provider quota', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			processOcrBatch([first], client(null).gateway, { signal: controller.signal })
		).rejects.toEqual(expect.objectContaining({ name: 'AbortError' }));

		const temporary = new Response(
			JSON.stringify({ code: 'gemini_rate_limited', retryable: true }),
			{ status: 429, headers: { 'Content-Type': 'application/json' } }
		);
		await expect(
			processOcrBatch([first], client(null, { context: temporary }).gateway)
		).rejects.toEqual(expect.objectContaining({ code: 'gemini_rate_limited', retryable: true }));

		const daily = new Response(JSON.stringify({ code: 'gemini_daily_quota', retryable: false }), {
			status: 429,
			headers: { 'Content-Type': 'application/json' }
		});
		await expect(
			processOcrBatch([first], client(null, { context: daily }).gateway)
		).rejects.toEqual(expect.objectContaining({ code: 'gemini_daily_quota', retryable: false }));
	});
});
