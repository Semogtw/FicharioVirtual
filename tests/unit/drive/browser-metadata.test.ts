import { describe, expect, it, vi } from 'vitest';
import { getBrowserDriveFileMetadata } from '../../../src/lib/drive/browser-metadata';

const accessToken = 'ephemeral-access-token-value';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const parentFolderId = '0AParentFolderId_123456789';

function client() {
	return {
		functions: {
			invoke: vi.fn().mockResolvedValue({
				data: { accessToken, expiresAt: '2026-08-07T20:00:00.000Z' },
				error: null
			})
		}
	} as never;
}

function metadata() {
	return {
		id: fileId,
		name: 'Apostila grande.pdf',
		mimeType: 'application/pdf',
		parents: [parentFolderId],
		modifiedTime: '2026-08-07T18:30:00.000Z',
		version: '4',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('getBrowserDriveFileMetadata', () => {
	it('reads only the exact identity fields needed to validate a staged copy', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(metadata()), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const driveClient = client();

		await expect(
			getBrowserDriveFileMetadata({ client: driveClient, fileId, fetchImpl })
		).resolves.toEqual(metadata());

		expect(driveClient.functions.invoke).toHaveBeenCalledTimes(1);
		const [requested, init] = fetchImpl.mock.calls[0] ?? [];
		const url = new URL(requested);
		expect(url.pathname).toBe(`/drive/v3/files/${fileId}`);
		expect(url.searchParams.get('fields')).toBe(
			'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed'
		);
		expect(init).toMatchObject({
			cache: 'no-store',
			redirect: 'error',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`
			}
		});
	});

	it('rejects widened or malformed provider responses', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ...metadata(), accessToken: 'must-not-pass' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		await expect(
			getBrowserDriveFileMetadata({ client: client(), fileId, fetchImpl })
		).rejects.toThrow('Não foi possível verificar o arquivo preservado no Google Drive.');
	});

	it('rejects invalid Drive identifiers before requesting a token', async () => {
		const driveClient = client();
		await expect(
			getBrowserDriveFileMetadata({ client: driveClient, fileId: 'bad id', fetchImpl: vi.fn() })
		).rejects.toThrow('Invalid Google Drive file identifier');
		expect(driveClient.functions.invoke).not.toHaveBeenCalled();
	});
});
