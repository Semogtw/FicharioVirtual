import { describe, expect, it, vi } from 'vitest';
import { reconcileOrphanedDrivePdfReferenceCopies } from '../../../src/lib/pdf/drive-reference-orphan-reconciliation';

const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-08-07T22:00:00.000Z');
const old = '2026-08-07T20:00:00.000Z';
const young = '2026-08-07T21:30:00.000Z';

const orphanDocumentId = '11111111-1111-4111-8111-111111111111';
const liveDocumentId = '22222222-2222-4222-8222-222222222222';
const youngDocumentId = '33333333-3333-4333-8333-333333333333';
const secondOrphanDocumentId = '44444444-4444-4444-8444-444444444444';
const parentFolderId = '0AParentFolderId_123456789';

const orphanFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const liveFileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const youngFileId = '3AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const secondOrphanFileId = '4AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function copy(fileId: string, documentId: string, createdAt: string) {
	return { fileId, documentId, parentFolderId, createdAt } as const;
}

function dependencies() {
	return {
		listCopies: vi.fn().mockResolvedValue([
			copy(orphanFileId, orphanDocumentId, old),
			copy(liveFileId, liveDocumentId, old),
			copy(youngFileId, youngDocumentId, young),
			copy(secondOrphanFileId, secondOrphanDocumentId, old)
		]),
		findExistingDocumentIds: vi.fn().mockResolvedValue(new Set([liveDocumentId])),
		deleteFile: vi.fn().mockResolvedValue(undefined)
	};
}

describe('orphaned Drive PDF reference reconciliation', () => {
	it('deletes only old managed copies whose document never reached durable staging', async () => {
		const deps = dependencies();

		await expect(
			reconcileOrphanedDrivePdfReferenceCopies({
				client: {} as never,
				nowMs: now,
				minimumAgeMs: HOUR,
				dependencies: deps
			})
		).resolves.toEqual({ scanned: 4, eligible: 3, deleted: 2, failed: 0, preserved: 2 });

		expect(deps.findExistingDocumentIds).toHaveBeenCalledWith(
			[orphanDocumentId, liveDocumentId, secondOrphanDocumentId],
			expect.anything()
		);
		expect(deps.deleteFile.mock.calls.map((call) => call[0].fileId)).toEqual([
			orphanFileId,
			secondOrphanFileId
		]);
		expect(deps.deleteFile).not.toHaveBeenCalledWith(
			expect.objectContaining({ fileId: youngFileId })
		);
	});

	it('fails closed when the database cannot establish which document IDs exist', async () => {
		const deps = dependencies();
		deps.findExistingDocumentIds.mockRejectedValue(new Error('database unavailable'));

		await expect(
			reconcileOrphanedDrivePdfReferenceCopies({
				client: {} as never,
				nowMs: now,
				minimumAgeMs: HOUR,
				dependencies: deps
			})
		).rejects.toThrow('database unavailable');
		expect(deps.deleteFile).not.toHaveBeenCalled();
	});

	it('continues reconciling other orphans when one Drive deletion fails', async () => {
		const deps = dependencies();
		deps.deleteFile.mockRejectedValueOnce(new Error('temporary Drive failure')).mockResolvedValueOnce(undefined);

		await expect(
			reconcileOrphanedDrivePdfReferenceCopies({
				client: {} as never,
				nowMs: now,
				minimumAgeMs: HOUR,
				dependencies: deps
			})
		).resolves.toEqual({ scanned: 4, eligible: 3, deleted: 1, failed: 1, preserved: 2 });
		expect(deps.deleteFile).toHaveBeenCalledTimes(2);
	});

	it('rejects unsafe reconciliation timing inputs before listing Drive', async () => {
		const deps = dependencies();
		await expect(
			reconcileOrphanedDrivePdfReferenceCopies({
				client: {} as never,
				nowMs: now,
				minimumAgeMs: 30_000,
				dependencies: deps
			})
		).rejects.toThrow('Invalid Drive PDF orphan reconciliation window');
		expect(deps.listCopies).not.toHaveBeenCalled();
	});
});
