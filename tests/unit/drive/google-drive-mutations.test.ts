import { describe, expect, it, vi } from 'vitest';
import {
	deleteGoogleDriveItem,
	getGoogleDriveItem,
	updateGoogleDriveItem
} from '../../../supabase/functions/_shared/google-drive-mutations';

const accessToken = 'ephemeral-access-token-value';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const oldParentId = '0AOldParentFolderId_123456789';
const newParentId = '0ANewParentFolderId_123456789';

function file(overrides: Record<string, unknown> = {}) {
	return {
		id: fileId,
		name: 'Resumo.pdf',
		mimeType: 'application/pdf',
		parents: [oldParentId],
		modifiedTime: '2026-08-06T13:00:00.000Z',
		version: '5',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false,
		...overrides
	};
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('Google Drive item mutations', () => {
	it('gets one item by immutable Drive identity with strict fields', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(json(file()));

		await expect(getGoogleDriveItem({ accessToken, fileId, fetchImpl })).resolves.toEqual(file());
		const [requested, init] = fetchImpl.mock.calls[0];
		const url = new URL(requested);
		expect(url.origin).toBe('https://www.googleapis.com');
		expect(url.pathname).toBe(`/drive/v3/files/${fileId}`);
		expect(url.searchParams.get('supportsAllDrives')).toBe('false');
		expect(url.searchParams.get('fields')).toBe(
			'id,name,mimeType,parents,modifiedTime,version,md5Checksum,trashed'
		);
		expect(init).toEqual({
			headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
		});
	});

	it('renames and moves an item in one bounded PATCH', async () => {
		const updated = file({
			name: 'Resumo final.pdf',
			parents: [newParentId],
			modifiedTime: '2026-08-06T13:05:00.000Z',
			version: '6'
		});
		const fetchImpl = vi.fn().mockResolvedValue(json(updated));

		await expect(
			updateGoogleDriveItem({
				accessToken,
				fileId,
				name: 'Resumo final.pdf',
				addParentId: newParentId,
				removeParentId: oldParentId,
				fetchImpl
			})
		).resolves.toEqual(updated);
		const [requested, init] = fetchImpl.mock.calls[0];
		const url = new URL(requested);
		expect(url.pathname).toBe(`/drive/v3/files/${fileId}`);
		expect(url.searchParams.get('addParents')).toBe(newParentId);
		expect(url.searchParams.get('removeParents')).toBe(oldParentId);
		expect(url.searchParams.get('supportsAllDrives')).toBe('false');
		expect(init).toEqual({
			method: 'PATCH',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json; charset=UTF-8'
			},
			body: JSON.stringify({ name: 'Resumo final.pdf' })
		});
	});

	it('supports rename-only and move-only updates without broad metadata', async () => {
		const renameFetch = vi
			.fn()
			.mockResolvedValue(json(file({ name: 'Novo nome.pdf', version: '6' })));
		await updateGoogleDriveItem({
			accessToken,
			fileId,
			name: 'Novo nome.pdf',
			fetchImpl: renameFetch
		});
		expect(new URL(renameFetch.mock.calls[0][0]).searchParams.has('addParents')).toBe(false);
		expect(JSON.parse(renameFetch.mock.calls[0][1].body)).toEqual({ name: 'Novo nome.pdf' });

		const moveFetch = vi
			.fn()
			.mockResolvedValue(json(file({ parents: [newParentId], version: '6' })));
		await updateGoogleDriveItem({
			accessToken,
			fileId,
			addParentId: newParentId,
			removeParentId: oldParentId,
			fetchImpl: moveFetch
		});
		expect(JSON.parse(moveFetch.mock.calls[0][1].body)).toEqual({});
	});

	it('deletes idempotently on 204 or 404 and rejects other provider failures', async () => {
		const deleted = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		await expect(deleteGoogleDriveItem({ accessToken, fileId, fetchImpl: deleted })).resolves.toBe(
			undefined
		);
		expect(deleted).toHaveBeenCalledWith(
			`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=false`,
			{ method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
		);

		await expect(
			deleteGoogleDriveItem({
				accessToken,
				fileId,
				fetchImpl: vi.fn().mockResolvedValue(json({ error: 'not_found' }, 404))
			})
		).resolves.toBeUndefined();
		await expect(
			deleteGoogleDriveItem({
				accessToken,
				fileId,
				fetchImpl: vi.fn().mockResolvedValue(json({ error: 'rate_limited' }, 429))
			})
		).rejects.toThrow('Google Drive mutation failed');
	});

	it('rejects malformed requests, extra response fields and mismatched identities', async () => {
		await expect(
			updateGoogleDriveItem({ accessToken, fileId, fetchImpl: vi.fn() })
		).rejects.toThrow('Invalid Google Drive mutation');
		await expect(
			updateGoogleDriveItem({
				accessToken,
				fileId,
				addParentId: oldParentId,
				removeParentId: oldParentId,
				fetchImpl: vi.fn()
			})
		).rejects.toThrow('Invalid Google Drive mutation');
		await expect(
			getGoogleDriveItem({
				accessToken,
				fileId,
				fetchImpl: vi.fn().mockResolvedValue(json({ ...file(), refreshToken: 'secret' }))
			})
		).rejects.toThrow('Invalid Google Drive item response');
		await expect(
			getGoogleDriveItem({
				accessToken,
				fileId,
				fetchImpl: vi.fn().mockResolvedValue(json(file({ id: '9DifferentFileId_123456789' })))
			})
		).rejects.toThrow('Invalid Google Drive item response');
		await expect(
			getGoogleDriveItem({ accessToken: 'short', fileId, fetchImpl: vi.fn() })
		).rejects.toThrow('Invalid Google Drive access token');
	});
});
