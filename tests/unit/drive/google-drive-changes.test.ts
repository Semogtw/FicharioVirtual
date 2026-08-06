import { describe, expect, it, vi } from 'vitest';
import { listGoogleDriveChanges } from '../../../supabase/functions/_shared/google-drive-changes';

const accessToken = 'ephemeral-access-token-value';
const pageToken = 'change-page-token';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const folderId = '0AParentFolderId_123456789';

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function file() {
	return {
		id: fileId,
		name: 'Resumo.pdf',
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: '2026-08-06T10:00:00.000Z',
		version: '9',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('Google Drive change feed client', () => {
	it('requests one bounded page and normalizes the provider response strictly', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			json({
				kind: 'drive#changeList',
				changes: [
					{ kind: 'drive#change', type: 'file', fileId, removed: false, file: file() },
					{
						kind: 'drive#change',
						type: 'file',
						fileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
						removed: true
					}
				],
				nextPageToken: 'next-change-page-token'
			})
		);

		await expect(
			listGoogleDriveChanges({ accessToken, pageToken, fetchImpl })
		).resolves.toEqual({
			changes: [
				{ fileId, removed: false, file: file() },
				{ fileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456', removed: true }
			],
			nextPageToken: 'next-change-page-token',
			newStartPageToken: null
		});

		const [requested, init] = fetchImpl.mock.calls[0];
		const url = new URL(requested);
		expect(url.origin).toBe('https://www.googleapis.com');
		expect(url.pathname).toBe('/drive/v3/changes');
		expect(url.searchParams.get('pageToken')).toBe(pageToken);
		expect(url.searchParams.get('pageSize')).toBe('100');
		expect(url.searchParams.get('spaces')).toBe('drive');
		expect(url.searchParams.get('includeRemoved')).toBe('true');
		expect(url.searchParams.get('supportsAllDrives')).toBe('false');
		expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('false');
		expect(url.searchParams.get('fields')).toContain('changes(fileId,removed,file(');
		expect(init).toEqual({
			headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
		});
	});

	it('accepts a final new start token and rejects ambiguous or malformed pages', async () => {
		const finalFetch = vi.fn().mockResolvedValue(
			json({
				kind: 'drive#changeList',
				changes: [],
				newStartPageToken: 'fresh-start-token'
			})
		);
		await expect(
			listGoogleDriveChanges({ accessToken, pageToken, fetchImpl: finalFetch })
		).resolves.toEqual({
			changes: [],
			nextPageToken: null,
			newStartPageToken: 'fresh-start-token'
		});

		const ambiguous = vi.fn().mockResolvedValue(
			json({
				kind: 'drive#changeList',
				changes: [],
				nextPageToken: 'next',
				newStartPageToken: 'fresh'
			})
		);
		await expect(
			listGoogleDriveChanges({ accessToken, pageToken, fetchImpl: ambiguous })
		).rejects.toThrow('Invalid Google Drive change response');

		const malformed = vi.fn().mockResolvedValue(
			json({
				kind: 'drive#changeList',
				changes: [{ fileId, removed: false, file: { ...file(), accessToken: 'must-not-pass' } }],
				newStartPageToken: 'fresh'
			})
		);
		await expect(
			listGoogleDriveChanges({ accessToken, pageToken, fetchImpl: malformed })
		).rejects.toThrow('Invalid Google Drive change response');
	});

	it('rejects invalid credentials, tokens, provider errors and duplicate change IDs', async () => {
		const duplicateFetch = vi.fn().mockResolvedValue(
			json({
				kind: 'drive#changeList',
				changes: [
					{ fileId, removed: true },
					{ fileId, removed: true }
				],
				newStartPageToken: 'fresh'
			})
		);
		await expect(
			listGoogleDriveChanges({ accessToken, pageToken, fetchImpl: duplicateFetch })
		).rejects.toThrow('Invalid Google Drive change response');
		await expect(
			listGoogleDriveChanges({ accessToken: 'short', pageToken, fetchImpl: duplicateFetch })
		).rejects.toThrow('Invalid Google Drive access token');
		await expect(
			listGoogleDriveChanges({ accessToken, pageToken: '', fetchImpl: duplicateFetch })
		).rejects.toThrow('Invalid Google Drive page token');
		await expect(
			listGoogleDriveChanges({
				accessToken,
				pageToken,
				fetchImpl: vi.fn().mockResolvedValue(json({ error: 'rate_limited' }, 429))
			})
		).rejects.toThrow('Google Drive change request failed');
	});
});
