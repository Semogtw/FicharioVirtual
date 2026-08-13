import { describe, expect, it, vi } from 'vitest';
import {
	downloadBrowserDriveFile,
	downloadBrowserDriveRange
} from '../../../src/lib/drive/browser-download';

const accessToken = 'ephemeral-access-token-value';
const expiresAt = '2026-08-13T08:00:00.000Z';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function client() {
	return {
		functions: {
			invoke: vi.fn().mockResolvedValue({ data: { accessToken, expiresAt }, error: null })
		}
	};
}

describe('redirect-safe browser Drive downloads', () => {
	it('lets fetch follow the Drive media redirect for a complete file', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { 'Content-Type': 'application/pdf', 'Content-Length': '3' }
			})
		);

		const blob = await downloadBrowserDriveFile({
			client: client(),
			fileId,
			maximumBytes: 20,
			fetchImpl
		});

		expect(blob.size).toBe(3);
		const [requested, init] = fetchImpl.mock.calls[0];
		expect(new URL(requested).hostname).toBe('www.googleapis.com');
		expect(new URL(requested).searchParams.get('alt')).toBe('media');
		expect(init.redirect).toBeUndefined();
		expect(init.cache).toBe('no-store');
		expect(init.headers).toEqual({ Authorization: `Bearer ${accessToken}` });
	});

	it('lets fetch follow the Drive media redirect while preserving an exact range request', async () => {
		const bytes = new Uint8Array(1024).fill(7);
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(bytes, {
				status: 206,
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Length': '1024',
					'Content-Range': 'bytes 1024-2047/4096'
				}
			})
		);

		const blob = await downloadBrowserDriveRange({
			client: client(),
			fileId,
			start: 1024,
			endExclusive: 2048,
			totalBytes: 4096,
			fetchImpl
		});

		expect(blob.size).toBe(1024);
		const [, init] = fetchImpl.mock.calls[0];
		expect(init.redirect).toBeUndefined();
		expect(init.headers).toMatchObject({
			Authorization: `Bearer ${accessToken}`,
			Range: 'bytes=1024-2047'
		});
	});
});
