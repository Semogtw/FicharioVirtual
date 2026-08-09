import { describe, expect, it, vi } from 'vitest';
import { downloadBoundedBrowserDriveFile } from '../../../src/lib/drive/bounded-download';
import type { DriveTokenClientLike } from '../../../src/lib/drive/browser-upload';

function client(): DriveTokenClientLike {
	return {
		functions: {
			invoke: vi.fn(async () => ({
				data: {
					accessToken: 'drive-token-12345',
					expiresAt: '2026-08-09T08:00:00.000Z'
				},
				error: null
			}))
		}
	};
}

function chunkedResponse(chunks: readonly string[], contentType = 'image/jpeg') {
	const encoder = new TextEncoder();
	let index = 0;
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[index++];
				if (chunk === undefined) controller.close();
				else controller.enqueue(encoder.encode(chunk));
			}
		}),
		{ status: 200, headers: { 'Content-Type': contentType } }
	);
}

describe('downloadBoundedBrowserDriveFile', () => {
	it('streams a response without Content-Length inside the configured ceiling', async () => {
		const fetchImpl = vi.fn(async () => chunkedResponse(['abc', 'def']));
		const result = await downloadBoundedBrowserDriveFile({
			client: client(),
			fileId: 'abcdefghij',
			maximumBytes: 6,
			fetchImpl
		});

		expect(result.size).toBe(6);
		expect(result.type).toBe('image/jpeg');
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://www.googleapis.com/drive/v3/files/abcdefghij?alt=media',
			expect.objectContaining({
				redirect: 'error',
				cache: 'no-store',
				headers: { Authorization: 'Bearer drive-token-12345' }
			})
		);
	});

	it('cancels a chunked response once cumulative bytes exceed the ceiling', async () => {
		await expect(
			downloadBoundedBrowserDriveFile({
				client: client(),
				fileId: 'abcdefghij',
				maximumBytes: 5,
				fetchImpl: async () => chunkedResponse(['abc', 'def'])
			})
		).rejects.toBeInstanceOf(RangeError);
	});

	it('rejects an oversized declared response before materializing a Blob', async () => {
		await expect(
			downloadBoundedBrowserDriveFile({
				client: client(),
				fileId: 'abcdefghij',
				maximumBytes: 5,
				fetchImpl: async () =>
					new Response('x', {
						status: 200,
						headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '6' }
					})
			})
		).rejects.toBeInstanceOf(RangeError);
	});
});
