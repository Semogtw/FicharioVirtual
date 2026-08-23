import { describe, expect, it, vi } from 'vitest';
import {
	NativePdfDataRangeTransport,
	NATIVE_PDF_RANGE_CHUNK_BYTES,
	openNativePdfRangeDocument
} from '../../../src/lib/pdf/native-range-transport';

const documentId = '550e8400-e29b-41d4-a716-446655440000';
const totalBytes = 120 * 1024 * 1024;

async function flush() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('NativePdfDataRangeTransport', () => {
	it('maps PDF.js requests to exact local catalog ranges', async () => {
		const readRange = vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3, 4]));
		const onFailure = vi.fn();
		const transport = new NativePdfDataRangeTransport({
			documentId,
			totalBytes,
			readRange,
			onFailure
		});
		const onDataRange = vi.fn();
		transport.onDataRange = onDataRange;

		transport.requestDataRange(1024, 1028);
		await flush();

		expect(readRange).toHaveBeenCalledWith(documentId, 1024, 1028);
		expect(onDataRange).toHaveBeenCalledWith(1024, Uint8Array.from([1, 2, 3, 4]));
		expect(onFailure).not.toHaveBeenCalled();
	});

	it('reports a local read failure once and stops subsequent ranges', async () => {
		const failure = new Error('local range unavailable');
		const readRange = vi.fn().mockRejectedValue(failure);
		const onFailure = vi.fn();
		const transport = new NativePdfDataRangeTransport({
			documentId,
			totalBytes,
			readRange,
			onFailure
		});

		transport.requestDataRange(0, 1024);
		await flush();
		transport.requestDataRange(1024, 2048);
		await flush();

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(failure);
		expect(readRange).toHaveBeenCalledOnce();
	});
});

describe('openNativePdfRangeDocument', () => {
	it('keeps PDF.js on the local range transport without a URL or full buffer', async () => {
		const document = { numPages: 321 } as never;
		const destroy = vi.fn().mockResolvedValue(undefined);
		const configureWorker = vi.fn().mockResolvedValue(undefined);
		const createLoadingTask = vi.fn(() => ({
			promise: Promise.resolve(document),
			destroy
		}));

		const opened = await openNativePdfRangeDocument({
			documentId,
			totalBytes,
			dependencies: {
				readRange: vi.fn(),
				configureWorker,
				createLoadingTask
			}
		});

		expect(opened.document).toBe(document);
		expect(configureWorker).toHaveBeenCalledOnce();
		expect(createLoadingTask).toHaveBeenCalledOnce();
		const source = createLoadingTask.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(source).toMatchObject({
			rangeChunkSize: NATIVE_PDF_RANGE_CHUNK_BYTES,
			disableStream: true,
			disableAutoFetch: true,
			disableRange: false
		});
		expect(source).not.toHaveProperty('url');
		expect(source).not.toHaveProperty('data');
		expect(source.range).toBeInstanceOf(NativePdfDataRangeTransport);

		await opened.destroy();
		await opened.destroy();
		expect(destroy).toHaveBeenCalledOnce();
	});
});
