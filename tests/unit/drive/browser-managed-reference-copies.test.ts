import { describe, expect, it, vi } from 'vitest';
import {
	copyBrowserDriveFile,
	listBrowserDrivePdfReferenceCopies
} from '../../../src/lib/drive/browser-files';

const accessToken = 'ephemeral-access-token-value';
const expiresAt = '2026-08-07T22:00:00.000Z';
const sourceFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const copiedFileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const parentFolderId = '0AParentFolderId_123456789';
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
		modifiedTime: '2026-08-07T20:30:00.000Z',
		version: '1',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('managed oversized Drive PDF copies', () => {
	it('stamps private app properties into the copy request', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(copiedFile()), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		await copyBrowserDriveFile({
			client: client(),
			sourceFileId,
			parentFolderId,
			name: 'Cópia.pdf',
			appProperties: {
				ficharioPurpose: 'oversized_pdf_reference',
				ficharioDocumentId: documentId
			},
			fetchImpl
		});

		const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string);
		expect(body).toEqual({
			name: 'Cópia.pdf',
			parents: [parentFolderId],
			appProperties: {
				ficharioPurpose: 'oversized_pdf_reference',
				ficharioDocumentId: documentId
			}
		});
	});

	it('lists only app-private oversized-PDF copies with strict pagination and metadata', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						files: [
							{
								id: copiedFileId,
								name: 'Cópia.pdf',
								mimeType: 'application/pdf',
								parents: [parentFolderId],
								createdTime: '2026-08-07T19:00:00.000Z',
								trashed: false,
								appProperties: {
									ficharioPurpose: 'oversized_pdf_reference',
									ficharioDocumentId: documentId
								}
							}
						],
						nextPageToken: 'next-token'
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				)
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ files: [] }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				})
			);

		await expect(
			listBrowserDrivePdfReferenceCopies({ client: client(), fetchImpl })
		).resolves.toEqual([
			{
				fileId: copiedFileId,
				documentId,
				parentFolderId,
				createdAt: '2026-08-07T19:00:00.000Z'
			}
		]);

		const first = new URL(fetchImpl.mock.calls[0]?.[0] as string);
		expect(first.pathname).toBe('/drive/v3/files');
		expect(first.searchParams.get('q')).toBe(
			"appProperties has { key='ficharioPurpose' and value='oversized_pdf_reference' } and trashed = false"
		);
		expect(first.searchParams.get('spaces')).toBe('drive');
		expect(first.searchParams.get('pageSize')).toBe('100');
		expect(first.searchParams.get('fields')).toContain('appProperties');
		const second = new URL(fetchImpl.mock.calls[1]?.[0] as string);
		expect(second.searchParams.get('pageToken')).toBe('next-token');
	});

	it('rejects malformed private properties before making a Drive request', async () => {
		const fetchImpl = vi.fn();
		await expect(
			copyBrowserDriveFile({
				client: client(),
				sourceFileId,
				parentFolderId,
				appProperties: { 'bad key': documentId },
				fetchImpl
			})
		).rejects.toThrow('Invalid Google Drive app properties');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
