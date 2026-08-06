import { describe, expect, it, vi } from 'vitest';
import {
	createDriveFolder,
	ensureDriveFolder
} from '../../../supabase/functions/_shared/google-drive-client';

const accessToken = 'ephemeral-access-token';
const parentId = '0AParentFolderId_123456789';
const folderId = '0AChildFolderId_123456789';

function folder(id = folderId) {
	return {
		id,
		name: 'Genética',
		mimeType: 'application/vnd.google-apps.folder',
		parents: [parentId],
		modifiedTime: '2026-08-06T08:00:00.000Z',
		version: '2',
		trashed: false
	};
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('Drive notebook folders', () => {
	it('creates a folder under an exact parent identity', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json(folder(), 201));

		await expect(
			createDriveFolder({ accessToken, name: 'Genética', parentId, fetchImpl })
		).resolves.toEqual(folder());
		const [, init] = fetchImpl.mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({
			name: 'Genética',
			mimeType: 'application/vnd.google-apps.folder',
			parents: [parentId]
		});
	});

	it('reuses one child folder and creates it only when absent', async () => {
		const existingFetch = vi.fn().mockResolvedValue(json({ files: [folder()] }));
		await expect(
			ensureDriveFolder({ accessToken, name: 'Genética', parentId, fetchImpl: existingFetch })
		).resolves.toEqual(folder());
		expect(existingFetch).toHaveBeenCalledTimes(1);
		const listUrl = new URL(existingFetch.mock.calls[0][0]);
		expect(listUrl.searchParams.get('q')).toContain(`'${parentId}' in parents`);

		const createFetch = vi
			.fn()
			.mockResolvedValueOnce(json({ files: [] }))
			.mockResolvedValueOnce(json(folder(), 201));
		await expect(
			ensureDriveFolder({ accessToken, name: 'Genética', parentId, fetchImpl: createFetch })
		).resolves.toEqual(folder());
		expect(createFetch).toHaveBeenCalledTimes(2);
	});

	it('rejects duplicate child folders instead of guessing by name', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(json({ files: [folder(), folder('0ASecondChildFolderId_123456789')] }));

		await expect(
			ensureDriveFolder({ accessToken, name: 'Genética', parentId, fetchImpl })
		).rejects.toThrow('Ambiguous Google Drive folder');
	});
});
