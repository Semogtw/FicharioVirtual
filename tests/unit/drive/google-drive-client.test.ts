import { describe, expect, it, vi } from 'vitest';
import {
	bootstrapDriveRoot,
	getDriveStartPageToken,
	listDriveFolders
} from '../../../supabase/functions/_shared/google-drive-client';

const accessToken = 'ephemeral-access-token';
const rootId = '0AExampleRootFolderId_123456789';

function folder(id = rootId) {
	return {
		id,
		name: 'Fichário Digital',
		mimeType: 'application/vnd.google-apps.folder',
		parents: ['root-parent-id-123456789'],
		modifiedTime: '2026-08-06T05:00:00.000Z',
		version: '1',
		trashed: false
	};
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('Google Drive API client', () => {
	it('lists folders using a safe q parameter and strict fields', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ files: [folder()] }));

		await expect(
			listDriveFolders({
				accessToken,
				query:
					"name = 'Fichário Digital' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
				fetchImpl
			})
		).resolves.toEqual([folder()]);
		const [requested, init] = fetchImpl.mock.calls[0];
		const url = new URL(requested);
		expect(url.origin).toBe('https://www.googleapis.com');
		expect(url.pathname).toBe('/drive/v3/files');
		expect(url.searchParams.get('spaces')).toBe('drive');
		expect(url.searchParams.get('pageSize')).toBe('10');
		expect(url.searchParams.get('q')).toContain('Fichário Digital');
		expect(url.searchParams.get('fields')).toContain('files(id,name,mimeType');
		expect(init).toEqual({
			headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
		});
	});

	it('parses the initial change token strictly', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json({ startPageToken: 'initial-change-token' }));

		await expect(getDriveStartPageToken({ accessToken, fetchImpl })).resolves.toBe(
			'initial-change-token'
		);
		expect(fetchImpl.mock.calls[0][0]).toContain('/drive/v3/changes/startPageToken');
		await expect(getDriveStartPageToken({ accessToken: 'short', fetchImpl })).rejects.toThrow(
			'Invalid Google Drive access token'
		);
	});

	it('reuses one existing root and obtains the feed token', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(json({ files: [folder()] }))
			.mockResolvedValueOnce(json({ startPageToken: 'initial-change-token' }));

		await expect(
			bootstrapDriveRoot({ accessToken, rootFolderName: 'Fichário Digital', fetchImpl })
		).resolves.toEqual({ rootFolder: folder(), startPageToken: 'initial-change-token' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('creates the root when absent and rejects ambiguous duplicate roots', async () => {
		const createFetch = vi
			.fn()
			.mockResolvedValueOnce(json({ files: [] }))
			.mockResolvedValueOnce(json(folder(), 201))
			.mockResolvedValueOnce(json({ startPageToken: 'initial-change-token' }));

		await expect(
			bootstrapDriveRoot({ accessToken, rootFolderName: 'Fichário Digital', fetchImpl: createFetch })
		).resolves.toEqual({ rootFolder: folder(), startPageToken: 'initial-change-token' });
		const [createUrl, createInit] = createFetch.mock.calls[1];
		expect(createUrl).toContain('/drive/v3/files?');
		expect(createInit.method).toBe('POST');
		expect(JSON.parse(createInit.body)).toEqual({
			name: 'Fichário Digital',
			mimeType: 'application/vnd.google-apps.folder'
		});

		const duplicateFetch = vi.fn().mockResolvedValue(
			json({ files: [folder(), folder('0ASecondRootFolderId_123456789')] })
		);
		await expect(
			bootstrapDriveRoot({
				accessToken,
				rootFolderName: 'Fichário Digital',
				fetchImpl: duplicateFetch
			})
		).rejects.toThrow('Ambiguous Google Drive root folder');
	});
});
