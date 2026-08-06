import { describe, expect, it, vi } from 'vitest';
import {
	listOpenDriveConflicts,
	resolveDriveConflict
} from '../../../src/lib/services/drive-conflicts';

const conflictId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';

const conflict = {
	id: conflictId,
	document_id: documentId,
	notebook_id: null,
	kind: 'remote_deleted_local_changed',
	created_at: '2026-08-06T15:00:00.000Z'
};

describe('Drive conflict service', () => {
	it('lists a strict bounded public projection', async () => {
		const limit = vi.fn().mockResolvedValue({ data: [conflict], error: null });
		const order = vi.fn(() => ({ limit }));
		const is = vi.fn(() => ({ order }));
		const select = vi.fn(() => ({ is }));
		const from = vi.fn(() => ({ select }));

		await expect(listOpenDriveConflicts({ from } as never)).resolves.toEqual([
			{
				id: conflictId,
				documentId,
				notebookId: null,
				kind: 'remote_deleted_local_changed',
				createdAt: '2026-08-06T15:00:00.000Z'
			}
		]);
		expect(select).toHaveBeenCalledWith('id,document_id,notebook_id,kind,created_at');
		expect(is).toHaveBeenCalledWith('resolved_at', null);
		expect(limit).toHaveBeenCalledWith(100);
	});

	it('resolves only supported choices through the owner RPC', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
		await expect(resolveDriveConflict(conflictId, 'retry_local', { rpc } as never)).resolves.toBe(
			undefined
		);
		expect(rpc).toHaveBeenCalledWith('resolve_drive_conflict', {
			target_conflict_id: conflictId,
			target_resolution: 'retry_local'
		});

		await expect(resolveDriveConflict(conflictId, 'mark_missing', { rpc } as never)).resolves.toBe(
			undefined
		);
	});

	it('rejects malformed rows, identifiers and RPC failures', async () => {
		const query = (data: unknown, error: unknown = null) => ({
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					is: vi.fn(() => ({
						order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data, error }) }))
					}))
				}))
			}))
		});
		await expect(
			listOpenDriveConflicts(query([{ ...conflict, refresh_token: 'secret' }]) as never)
		).rejects.toThrow('Não foi possível carregar os conflitos do Google Drive.');
		await expect(
			resolveDriveConflict('bad-id', 'retry_local', { rpc: vi.fn() } as never)
		).rejects.toThrow('Não foi possível resolver o conflito do Google Drive.');
		await expect(
			resolveDriveConflict(conflictId, 'retry_local', {
				rpc: vi.fn().mockResolvedValue({ data: false, error: null })
			} as never)
		).rejects.toThrow('Não foi possível resolver o conflito do Google Drive.');
	});
});
