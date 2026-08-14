import { describe, expect, it, vi } from 'vitest';
import {
	downloadBrowserDriveFile,
	downloadBrowserDriveRange
} from '../../../src/lib/drive/browser-download';

const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function client(...responses: Array<{ data: unknown; error: unknown }>) {
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
	it('downloads a complete file through metadata plus bounded media reads', async () => {
		const proxy = client(
			{ data: { size: 3, mimeType: 'application/pdf' }, error: null },
			{ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }
		);

		const blob = await downloadBrowserDriveFile({
			client: proxy,
			fileId,
			maximumBytes: 20
		});

		expect(blob.size).toBe(3);
		expect(blob.type).toBe('application/pdf');
		expect(proxy.functions.invoke).toHaveBeenNthCalledWith(1, 'drive-media', {
			body: { operation: 'metadata', fileId }
		});
		expect(proxy.functions.invoke).toHaveBeenNthCalledWith(2, 'drive-media', {
			body: { operation: 'read', fileId, start: 0, endExclusive: 3, totalBytes: 3 }
		});
	});

	it('splits larger files into one-megabyte proxy reads', async () => {
		const first = new Uint8Array(1024 * 1024).fill(7);
		const second = new Uint8Array([8, 9, 10]);
		const total = first.byteLength + second.byteLength;
		const proxy = client(
			{ data: { size: total, mimeType: 'application/pdf' }, error: null },
			{ data: new Blob([first]), error: null },
			{ data: new Blob([second]), error: null }
		);

		const blob = await downloadBrowserDriveFile({
			client: proxy,
			fileId,
			maximumBytes: total
		});

		expect(blob.size).toBe(total);
		expect(proxy.functions.invoke).toHaveBeenCalledTimes(3);
		expect(proxy.functions.invoke).toHaveBeenNthCalledWith(3, 'drive-media', {
			body: {
				operation: 'read',
				fileId,
				start: 1024 * 1024,
				endExclusive: total,
				totalBytes: total
			}
		});
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

	it('rejects a file above the caller limit before transferring media chunks', async () => {
		const proxy = client({ data: { size: 21, mimeType: 'application/pdf' }, error: null });

		await expect(
			downloadBrowserDriveFile({ client: proxy, fileId, maximumBytes: 20 })
		).rejects.toThrow('grande demais');
		expect(proxy.functions.invoke).toHaveBeenCalledTimes(1);
	});

	it('fails closed when the proxy returns a chunk with the wrong size', async () => {
		const proxy = client(
			{ data: { size: 4, mimeType: 'application/pdf' }, error: null },
			{ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }
		);

		await expect(
			downloadBrowserDriveFile({ client: proxy, fileId, maximumBytes: 20 })
		).rejects.toThrow('Não foi possível baixar');
	});
});
