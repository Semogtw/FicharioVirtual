import { describe, expect, it, vi } from 'vitest';
import {
	downloadBrowserDriveFile,
	downloadBrowserDriveRange
} from '../../../src/lib/drive/browser-download';

const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

type ProxyResponse = { data: unknown; error: unknown; response?: Response };

function client(...responses: ProxyResponse[]) {
	return {
		functions: {
			invoke: vi.fn().mockImplementation(async () => {
				const next = responses.shift();
				if (!next) throw new Error('Unexpected drive-media invocation');
				return next;
			})
		}
	};
}

describe('authenticated browser Drive media proxy', () => {
	it('downloads a complete file through one bounded media request and preserves its MIME type', async () => {
		const proxy = client({
			data: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }),
			error: null,
			response: new Response(null, { headers: { 'X-Drive-Media-Type': 'image/jpeg' } })
		});

		const blob = await downloadBrowserDriveFile({
			client: proxy,
			fileId,
			maximumBytes: 20
		});

		expect(blob.size).toBe(3);
		expect(blob.type).toBe('image/jpeg');
		expect(proxy.functions.invoke).toHaveBeenCalledTimes(1);
		expect(proxy.functions.invoke).toHaveBeenCalledWith('drive-media', {
			body: { operation: 'download', fileId, maximumBytes: 20 }
		});
	});

	it('keeps larger browser downloads to one authenticated proxy invocation', async () => {
		const bytes = new Uint8Array(1024 * 1024 + 3).fill(7);
		const proxy = client({ data: new Blob([bytes], { type: 'application/octet-stream' }), error: null });

		const blob = await downloadBrowserDriveFile({
			client: proxy,
			fileId,
			maximumBytes: bytes.byteLength
		});

		expect(blob.size).toBe(bytes.byteLength);
		expect(proxy.functions.invoke).toHaveBeenCalledTimes(1);
	});

	it('preserves exact PDF.js range boundaries through the proxy', async () => {
		const bytes = new Uint8Array(1024).fill(7);
		const proxy = client({ data: new Blob([bytes]), error: null });

		const blob = await downloadBrowserDriveRange({
			client: proxy,
			fileId,
			start: 1024,
			endExclusive: 2048,
			totalBytes: 4096
		});

		expect(blob.size).toBe(1024);
		expect(proxy.functions.invoke).toHaveBeenCalledWith('drive-media', {
			body: {
				operation: 'read',
				fileId,
				start: 1024,
				endExclusive: 2048,
				totalBytes: 4096
			}
		});
	});

	it('fails closed when the proxy rejects an oversized complete download', async () => {
		const proxy = client({ data: null, error: new Error('413') });

		await expect(
			downloadBrowserDriveFile({ client: proxy, fileId, maximumBytes: 20 })
		).rejects.toThrow('Não foi possível baixar');
		expect(proxy.functions.invoke).toHaveBeenCalledTimes(1);
	});

	it('fails closed when the proxy returns an invalid complete download', async () => {
		const proxy = client({
			data: new Blob([new Uint8Array(21)]),
			error: null
		});

		await expect(
			downloadBrowserDriveFile({ client: proxy, fileId, maximumBytes: 20 })
		).rejects.toThrow('Não foi possível baixar');
	});
});
