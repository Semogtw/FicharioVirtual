import { describe, expect, it } from 'vitest';
import { synchronizeDriveChanges, type DriveSyncGateway } from '../../../src/lib/drive/sync-service';

const firstFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const secondFileId = '9ZyXwVuTsRqPoNmLkJiHgFeDcBa_654321';
const folderId = '0AExampleRootFolderId_123456789';

function file(id: string, version: string) {
	return {
		id,
		name: `${id}.pdf`,
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: `2026-08-06T0${version}:00:00.000Z`,
		version,
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('Drive change synchronization', () => {
	it('paginates changes and advances checkpoints only after each page is applied', async () => {
		const calls: string[] = [];
		const gateway: DriveSyncGateway = {
			async fetchChangePage(token) {
				calls.push(`fetch:${token}`);
				if (token === 'start-token') {
					return {
						changes: [{ fileId: firstFileId, removed: false, file: file(firstFileId, '1') }],
						nextPageToken: 'second-page',
						newStartPageToken: null
					};
				}
				return {
					changes: [{ fileId: secondFileId, removed: true }],
					nextPageToken: null,
					newStartPageToken: 'fresh-start-token'
				};
			},
			async applyChange(change) {
				calls.push(`apply:${change.fileId}`);
				return { status: 'applied' };
			},
			async recordConflict() {
				throw new Error('unexpected conflict');
			},
			async persistCheckpoint(token) {
				calls.push(`checkpoint:${token}`);
			}
		};

		const result = await synchronizeDriveChanges({ startPageToken: 'start-token', gateway });

		expect(result).toEqual({
			appliedChanges: 2,
			conflicts: 0,
			pages: 2,
			startPageToken: 'fresh-start-token'
		});
		expect(calls).toEqual([
			'fetch:start-token',
			`apply:${firstFileId}`,
			'checkpoint:second-page',
			'fetch:second-page',
			`apply:${secondFileId}`,
			'checkpoint:fresh-start-token'
		]);
	});

	it('does not advance the page token after an unapplied change', async () => {
		const checkpoints: string[] = [];
		const gateway: DriveSyncGateway = {
			async fetchChangePage() {
				return {
					changes: [{ fileId: firstFileId, removed: false, file: file(firstFileId, '1') }],
					nextPageToken: null,
					newStartPageToken: 'must-not-be-saved'
				};
			},
			async applyChange() {
				throw new Error('database unavailable');
			},
			async recordConflict() {},
			async persistCheckpoint(token) {
				checkpoints.push(token);
			}
		};

		await expect(
			synchronizeDriveChanges({ startPageToken: 'start-token', gateway })
		).rejects.toThrow('database unavailable');
		expect(checkpoints).toEqual([]);
	});

	it('records one ambiguous conflict and continues unrelated changes', async () => {
		const applied: string[] = [];
		const conflicts: string[] = [];
		const gateway: DriveSyncGateway = {
			async fetchChangePage() {
				return {
					changes: [
						{ fileId: firstFileId, removed: false, file: file(firstFileId, '1') },
						{ fileId: secondFileId, removed: true }
					],
					nextPageToken: null,
					newStartPageToken: 'fresh-start-token'
				};
			},
			async applyChange(change) {
				if (change.fileId === firstFileId) {
					return { status: 'conflict', kind: 'ambiguous_order' };
				}
				applied.push(change.fileId);
				return { status: 'applied' };
			},
			async recordConflict(change, kind) {
				conflicts.push(`${change.fileId}:${kind}`);
			},
			async persistCheckpoint() {}
		};

		const result = await synchronizeDriveChanges({ startPageToken: 'start-token', gateway });

		expect(result.conflicts).toBe(1);
		expect(result.appliedChanges).toBe(1);
		expect(conflicts).toEqual([`${firstFileId}:ambiguous_order`]);
		expect(applied).toEqual([secondFileId]);
	});
});
