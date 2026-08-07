import { describe, expect, it, vi } from 'vitest';
import {
	copyBrowserDriveFile,
	deleteBrowserDriveFile,
	downloadBrowserDriveFile,
	downloadBrowserDriveRange
} from '../../../src/lib/drive/browser-files';

const accessToken = 'ephemeral-access-token-value';
const expiresAt = '2026-08-06T09:00:00.000Z';
const sourceFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const copiedFileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const parentFolderId = '0AParentFolderId_123456789';

function client() {
	return {
		functions: {
			invoke: vi.fn().mockResolvedValue({ data: { accessToken, expiresAt }, error: null })
		}
	};
}

function copiedFile() {
	return {
		id: copiedFileId,
		name: 'Cópia.pdf',
		mimeType: 'application/pdf',
		parents: [parentFolderId],
		modifiedTime: '2026-08-06T08:30:00.000Z',
		version: '1',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('browser Drive file operations', () => {
	it('copies a selected file into the controlled folder and validates the response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(copiedFile()), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		await expect(
			copyBrowserDriveFile({
				client: client(),
				sourceFileId,
				parentFolderId,
				name: 'Cópia.pdf',
				fetchImpl
			})
		).resolves.toEqual(copiedFile());
		const [requested, init] = fetchImpl.mock.calls[0];
		const url = new URL(requested);
		expect(url.pathname).toBe(`/drive/v3/files/${sourceFileId}/copy`);
		expect(init.method).toBe('POST');
		expect(init.headers).toMatchObject({ Authorization: `Bearer ${accessToken}` });
		expect(JSON.parse(init.body)).toEqual({ name: 'Cópia.pdf', parents: [parentFolderId] });
	});

	it('downloads a selected file without persisting its access token', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(new Uint8Array([1, 2, 3]), {
				status: 200,
				headers: { 'Content-Type': 'application/pdf', 'Content-Length': '3' }
			})
		);

		const result = await downloadBrowserDriveFile({
			client: client(),
			fileId: sourceFileId,
			maximumBytes: 20,
			fetchImpl
		});
		expect(result.type).toBe('application/pdf');
		expect(result.size).toBe(3);
		const [requested, init] = fetchImpl.mock.calls[0];
		expect(new URL(requested).searchParams.get('alt')).toBe('media');
		expect(init.headers).toEqual({ Authorization: `Bearer ${accessToken}` });
	});

	it('rejects oversized downloads before reading the body', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(new Uint8Array([1]), {
				status: 200,
				headers: { 'Content-Type': 'application/pdf', 'Content-Length': '200' }
			})
		);

		await expect(
			downloadBrowserDriveFile({
				client: client(),
				fileId: sourceFileId,
				maximumBytes: 20,
				fetchImpl
			})
		).rejects.toThrow('O arquivo selecionado no Google Drive é grande demais.');
	});

	it('downloads an exact byte range without allowing a full-file fallback', async () => {
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

		const result = await downloadBrowserDriveRange({
			client: client(),
			fileId: sourceFileId,
			start: 1024,
			endExclusive: 2048,
			totalBytes: 4096,
			fetchImpl
		});

		expect(result.size).toBe(1024);
		expect(result.type).toBe('application/pdf');
		const [requested, init] = fetchImpl.mock.calls[0];
		expect(new URL(requested).searchParams.get('alt')).toBe('media');
		expect(init.cache).toBe('no-store');
		expect(init.headers).toMatchObject({
			Authorization: `Bearer ${accessToken}`,
			Range: 'bytes=1024-2047'
		});
	});

	it('rejects providers that ignore or alter the requested byte range', async () => {
		const fullResponse = new Response(new Uint8Array(4096), {
			status: 200,
			headers: { 'Content-Type': 'application/pdf', 'Content-Length': '4096' }
		});
		const readFullBody = vi.spyOn(fullResponse, 'blob');
		await expect(
			downloadBrowserDriveRange({
				client: client(),
				fileId: sourceFileId,
				start: 0,
				endExclusive: 1024,
				totalBytes: 4096,
				fetchImpl: vi.fn().mockResolvedValue(fullResponse)
			})
		).rejects.toThrow('Não foi possível baixar parte do arquivo selecionado no Google Drive.');
		expect(readFullBody).not.toHaveBeenCalled();

		await expect(
			downloadBrowserDriveRange({
				client: client(),
				fileId: sourceFileId,
				start: 0,
				endExclusive: 1024,
				totalBytes: 4096,
				fetchImpl: vi.fn().mockResolvedValue(
					new Response(new Uint8Array(1024), {
						status: 206,
						headers: {
							'Content-Type': 'application/pdf',
							'Content-Range': 'bytes 1-1024/4096'
						}
					})
				)
			})
		).rejects.toThrow('Não foi possível baixar parte do arquivo selecionado no Google Drive.');
	});

	it('deletes an app-controlled file and treats an already-missing file as cleaned', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response(null, { status: 404 }));
		const input = { client: client(), fileId: copiedFileId, fetchImpl };

		await expect(deleteBrowserDriveFile(input)).resolves.toBeUndefined();
		await expect(deleteBrowserDriveFile(input)).resolves.toBeUndefined();
		expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
	});

	it('rejects malformed IDs and provider responses', async () => {
		await expect(
			copyBrowserDriveFile({
				client: client(),
				sourceFileId: 'bad id',
				parentFolderId,
				fetchImpl: vi.fn()
			})
		).rejects.toThrow('Invalid Google Drive file identifier');

		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ...copiedFile(), refreshToken: 'must-not-pass' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		await expect(
			copyBrowserDriveFile({
				client: client(),
				sourceFileId,
				parentFolderId,
				fetchImpl
			})
		).rejects.toThrow('Não foi possível copiar o arquivo no Google Drive.');
	});
});
