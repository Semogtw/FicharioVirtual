import { describe, expect, it } from 'vitest';
import {
	buildNotebookFolderChain,
	parseDriveNotebookRows
} from '../../../supabase/functions/_shared/drive-folder-chain';

const rootId = '11111111-1111-4111-8111-111111111111';
const childId = '22222222-2222-4222-8222-222222222222';
const leafId = '33333333-3333-4333-8333-333333333333';

function row(overrides: Record<string, unknown> = {}) {
	return {
		id: rootId,
		name: 'Biologia',
		parent_notebook_id: null,
		drive_folder_id: '0ABiologyFolderId_123456789',
		drive_missing: false,
		...overrides
	};
}

describe('Drive notebook folder chain', () => {
	it('parses exact notebook rows and orders ancestors from root to leaf', () => {
		const rows = parseDriveNotebookRows([
			row({ id: leafId, name: 'DNA', parent_notebook_id: childId, drive_folder_id: null }),
			row({ id: rootId }),
			row({
				id: childId,
				name: 'Genética',
				parent_notebook_id: rootId,
				drive_folder_id: null
			})
		]);

		expect(buildNotebookFolderChain(rows, leafId).map((item) => item.id)).toEqual([
			rootId,
			childId,
			leafId
		]);
		expect(Object.isFrozen(rows)).toBe(true);
		expect(Object.isFrozen(rows[0])).toBe(true);
	});

	it('rejects duplicate IDs, extra fields, cycles, and missing parents', () => {
		expect(() => parseDriveNotebookRows([row(), row()])).toThrow(
			'Invalid Drive notebook response'
		);
		expect(() => parseDriveNotebookRows([row({ token: 'must-not-pass' })])).toThrow(
			'Invalid Drive notebook response'
		);

		const cycle = parseDriveNotebookRows([
			row({ id: rootId, parent_notebook_id: childId }),
			row({ id: childId, parent_notebook_id: rootId })
		]);
		expect(() => buildNotebookFolderChain(cycle, rootId)).toThrow(
			'Invalid Drive notebook hierarchy'
		);

		const missing = parseDriveNotebookRows([row({ id: leafId, parent_notebook_id: childId })]);
		expect(() => buildNotebookFolderChain(missing, leafId)).toThrow(
			'Invalid Drive notebook hierarchy'
		);
	});

	it('rejects a target outside the authorized result set', () => {
		const rows = parseDriveNotebookRows([row()]);
		expect(() => buildNotebookFolderChain(rows, leafId)).toThrow(
			'Invalid Drive notebook hierarchy'
		);
	});
});
