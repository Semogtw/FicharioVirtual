import { describe, expect, it, vi } from 'vitest';
import { processPageOcr, type OcrFunctionClient } from '../../../src/lib/services/ocr';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

const pageId = '11111111-1111-4111-8111-111111111111';

describe('OCR request cancellation', () => {
	it('forwards the AbortSignal and rejects a result that completed after cancellation', async () => {
		const request = deferred<{
			data: unknown;
			error: null | { context?: unknown; message?: string };
		}>();
		const invoke = vi.fn(() => request.promise);
		const client = { functions: { invoke } } as unknown as OcrFunctionClient;
		const controller = new AbortController();

		const processing = processPageOcr(pageId, client, { signal: controller.signal });
		expect(invoke).toHaveBeenCalledWith('process-ocr', {
			body: { pageId },
			signal: controller.signal
		});

		controller.abort();
		request.resolve({
			data: { state: 'complete', needsReview: false, warningCount: 0 },
			error: null
		});

		await expect(processing).rejects.toMatchObject({ name: 'AbortError' });
	});

	it('does not invoke the Edge Function when the request is already cancelled', async () => {
		const invoke = vi.fn();
		const client = { functions: { invoke } } as unknown as OcrFunctionClient;
		const controller = new AbortController();
		controller.abort();

		await expect(
			processPageOcr(pageId, client, { signal: controller.signal })
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(invoke).not.toHaveBeenCalled();
	});
});
