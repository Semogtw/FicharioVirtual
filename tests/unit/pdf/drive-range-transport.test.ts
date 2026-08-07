import { describe, expect, it, vi } from 'vitest';
import {
	DRIVE_PDF_RANGE_CHUNK_BYTES,
	DrivePdfDataRangeTransport,
	openDrivePdfRangeDocument
} from '../../../src/lib/pdf/drive-range-transport';

const fileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const totalBytes = 120 * 1024 * 1024;

function client() {
	return {} as never;
}

async function flush() {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DrivePdfDataRangeTransport', () => {
	it('maps PDF.js range requests to exact Drive byte ranges', async () => {
		const downloadRange = vi.fn().mockResolvedValue(
			new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' })
		);
		const onFailure = vi.fn();
		const transport = new DrivePdfDataRangeTransport({
			client: client(),
			fileId,
			totalBytes,
			downloadRange,
			onFailure
		});
		const onDataRange = vi.fn();
		transport.onDataRange = onDataRange;

		transport.requestDataRange(1024, 1028);
		await flush();

		expect(downloadRange).toHaveBeenCalledWith(
			expect.objectContaining({
				client: expect.anything(),
				fileId,
				start: 1024,
				endExclusive: 1028,
				totalBytes
			})
		);
		expect(onDataRange).toHaveBeenCalledTimes(1);
		expect(onDataRange.mock.calls[0]?.[0]).toBe(1024);
		expect([...((onDataRange.mock.calls[0]?.[1] ?? new Uint8Array()) as Uint8Array)]).toEqual([
			1, 2, 3, 4
		]);
		expect(onFailure).not.toHaveBeenCalled();
	});

	it('reports a range failure once and stops delivering data after abort', async () => {
		const failure = new Error('range unavailable');
		const downloadRange = vi.fn().mockRejectedValue(failure);
		const onFailure = vi.fn();
		const transport = new DrivePdfDataRangeTransport({
			client: client(),
			fileId,
			totalBytes,
			downloadRange,
			onFailure
		});
		const onDataRange = vi.fn();
		transport.onDataRange = onDataRange;

		transport.requestDataRange(0, 1024);
		await flush();
		transport.requestDataRange(1024, 2048);
		await flush();

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(failure);
		expect(downloadRange).toHaveBeenCalledTimes(1);
		expect(onDataRange).not.toHaveBeenCalled();
	});
});

describe('openDrivePdfRangeDocument', () => {
	it('disables streaming and automatic prefetch while using the custom range transport', async () => {
		const document = { numPages: 321 } as never;
		const destroy = vi.fn().mockResolvedValue(undefined);
		const createLoadingTask = vi.fn((_source: unknown) => ({
			promise: Promise.resolve(document),
			destroy
		}));

		await expect(
			openDrivePdfRangeDocument({
				client: client(),
				fileId,
				totalBytes,
				dependencies: {
					downloadRange: vi.fn(),
					createLoadingTask
				}
			})
		).resolves.toBe(document);

		expect(createLoadingTask).toHaveBeenCalledTimes(1);
		const source = createLoadingTask.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(source).toMatchObject({
			rangeChunkSize: DRIVE_PDF_RANGE_CHUNK_BYTES,
			disableStream: true,
			disableAutoFetch: true,
			disableRange: false
		});
		expect(source).not.toHaveProperty('url');
		expect(source).not.toHaveProperty('data');
		expect(source.range).toBeInstanceOf(DrivePdfDataRangeTransport);
		expect(destroy).not.toHaveBeenCalled();
	});
});
