import { describe, expect, it } from 'vitest';
import { yieldImageImportToRemoteTab } from '$lib/import/image-import-cross-tab-yield';
import type { ImportBroadcastUpdate } from '$lib/import/import-broadcast';

function update(status: string, type: ImportBroadcastUpdate['type'] = 'image-import-updated') {
	return { type, id: 'shared-import', status } as ImportBroadcastUpdate;
}

describe('image import cross-tab yield', () => {
	it('yields a queued local copy after another tab proves it acquired the import lock', () => {
		const items = [{ id: 'shared-import', status: 'queued' as const, previewUrl: null }];

		expect(yieldImageImportToRemoteTab(items, update('preparing'))).toBe(true);
		expect(items).toEqual([]);
	});

	it('yields a waiting OCR retry when another tab already restarted server-side reading', () => {
		const items = [{ id: 'shared-import', status: 'waiting' as const, previewUrl: null }];

		expect(yieldImageImportToRemoteTab(items, update('reading'))).toBe(true);
		expect(items).toEqual([]);
	});

	it('does not yield before a remote tab has acquired the lock', () => {
		const items = [{ id: 'shared-import', status: 'queued' as const, previewUrl: null }];

		expect(yieldImageImportToRemoteTab(items, update('queued'))).toBe(false);
		expect(items).toHaveLength(1);
	});

	it('does not interfere with active local work, terminal updates, or PDF broadcasts', () => {
		for (const remoteUpdate of [update('waiting'), update('complete'), update('reading', 'pdf-import-updated')]) {
			const items = [{ id: 'shared-import', status: 'uploading' as const, previewUrl: null }];
			expect(yieldImageImportToRemoteTab(items, remoteUpdate)).toBe(false);
			expect(items).toHaveLength(1);
		}
	});
});
