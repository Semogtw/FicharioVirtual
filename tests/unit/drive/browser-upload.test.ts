import { describe, expect, it, vi } from 'vitest';
import {
	createBrowserDriveUploadGateway,
	createDriveResumableSession,
	requestDriveAccessToken,
	uploadBrowserBlobToDrive
} from '../../../src/lib/drive/browser-upload';

const accessToken = 'ephemeral-access-token-value';
const expiresAt = '2026-08-06T08:00:00.000Z';
const sessionUrl =
	'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=browser-session';
const folderId = '0AExampleRootFolderId_123456789';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function finalFile() {
	return {
		id: fileId,
		name: 'Resumo.pdf',
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: '2026-08-06T07:00:00.000Z',
		version: '1',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('browser Drive access token', () => {
	it('accepts only the strict ephemeral token response', async () => {
		const invoke = vi.fn().mockResolvedValue({
			data: { accessToken, expiresAt },
			error: null
		});

		await expect(requestDriveAccessToken({ functions: { invoke } })).resolves.toEqual({
			accessToken,
			expiresAt
		});
		expect(invoke).toHaveBeenCalledWith('drive-access-token', { body: {} });

		invoke.mockResolvedValueOnce({
			data: { accessToken, expiresAt, refreshToken: 'must-not-pass' },
			error: null
		});
		await expect(requestDriveAccessToken({ functions: { invoke } })).rejects.toThrow(
			'Não foi possível obter acesso temporário ao Google Drive.'
		);
	});
});

describe('browser Drive resumable session', () => {
	it('creates an official resumable session with exact metadata and upload headers', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 200,
				headers: { Location: sessionUrl }
			})
		);

		await expect(
			createDriveResumableSession({
				accessToken,
				name: 'Resumo.pdf',
				mimeType: 'application/pdf',
				parentFolderId: folderId,
				totalBytes: 1024,
				fetchImpl
			})
		).resolves.toBe(sessionUrl);

		const [requested, init] = fetchImpl.mock.calls[0];
		const url = new URL(requested);
		expect(url.origin).toBe('https://www.googleapis.com');
		expect(url.pathname).toBe('/upload/drive/v3/files');
		expect(url.searchParams.get('uploadType')).toBe('resumable');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json; charset=UTF-8',
			'X-Upload-Content-Length': '1024',
			'X-Upload-Content-Type': 'application/pdf'
		});
		expect(JSON.parse(init.body)).toEqual({
			name: 'Resumo.pdf',
			mimeType: 'application/pdf',
			parents: [folderId]
		});
	});

	it('rejects redirects, missing Location, and nonofficial session URLs', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: sessionUrl } }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }))
			.mockResolvedValueOnce(
				new Response(null, {
					status: 200,
					headers: { Location: 'https://evil.example/upload/drive/v3/files' }
				})
			);
		const input = {
			accessToken,
			name: 'Resumo.pdf',
			mimeType: 'application/pdf',
			parentFolderId: folderId,
			totalBytes: 1024,
			fetchImpl
		};

		await expect(createDriveResumableSession(input)).rejects.toThrow(
			'Não foi possível iniciar o upload no Google Drive.'
		);
		await expect(createDriveResumableSession(input)).rejects.toThrow(
			'Não foi possível iniciar o upload no Google Drive.'
		);
		await expect(createDriveResumableSession(input)).rejects.toThrow(
			'Não foi possível iniciar o upload no Google Drive.'
		);
	});
});

describe('browser Drive chunk gateway', () => {
	it('sends chunks and progress probes without persisting the token', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify(finalFile()), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);
		const gateway = createBrowserDriveUploadGateway({ accessToken, fetchImpl });

		await expect(
			gateway.uploadChunk({
				sessionUrl,
				body: new Blob([new Uint8Array(256 * 1024)]),
				contentRange: 'bytes 0-262143/524288'
			})
		).resolves.toEqual({ status: 308, range: 'bytes=0-262143', body: null });
		await expect(gateway.queryProgress({ sessionUrl, totalBytes: 524288 })).resolves.toEqual({
			status: 200,
			range: null,
			body: finalFile()
		});

		expect(fetchImpl.mock.calls[0][1]).toMatchObject({
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Range': 'bytes 0-262143/524288'
			}
		});
		expect(fetchImpl.mock.calls[1][1]).toMatchObject({
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Range': 'bytes */524288'
			}
		});
		expect(fetchImpl.mock.calls[1][1].headers).not.toHaveProperty('Content-Length');
	});
});

describe('browser Drive upload orchestration', () => {
	it('requests one ephemeral token, creates a session, and uploads the blob', async () => {
		const invoke = vi.fn().mockResolvedValue({ data: { accessToken, expiresAt }, error: null });
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: sessionUrl } }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify(finalFile()), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);

		await expect(
			uploadBrowserBlobToDrive({
				client: { functions: { invoke } },
				blob: new Blob([new Uint8Array(64 * 1024)], { type: 'application/pdf' }),
				name: 'Resumo.pdf',
				parentFolderId: folderId,
				fetchImpl
			})
		).resolves.toEqual(finalFile());
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
