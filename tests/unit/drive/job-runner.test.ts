import { describe, expect, it, vi } from 'vitest';
import {
	executeDriveJob,
	parseClaimedDriveJob,
	type DriveJobGateway
} from '../../../supabase/functions/_shared/drive-job-runner';

const jobId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';
const parentNotebookId = '33333333-3333-4333-8333-333333333333';
const documentId = '44444444-4444-4444-8444-444444444444';
const folderId = '0AFolderId_123456789';
const parentFolderId = '0AParentFolderId_123456789';
const nextParentFolderId = '0ANextParentFolderId_123456789';
const fileId = '1DriveFileId_123456789';

function item(overrides: Record<string, unknown> = {}) {
	return {
		id: folderId,
		name: 'Biologia',
		mimeType: 'application/vnd.google-apps.folder',
		parents: [parentFolderId],
		modifiedTime: '2026-08-06T14:00:00.000Z',
		version: '2',
		md5Checksum: null,
		trashed: false,
		...overrides
	};
}

function gateway(overrides: Partial<DriveJobGateway> = {}): DriveJobGateway {
	return {
		loadNotebook: vi.fn().mockResolvedValue({
			id: notebookId,
			name: 'Biologia',
			parentNotebookId,
			driveFolderId: folderId
		}),
		loadDocument: vi.fn().mockResolvedValue({
			id: documentId,
			kind: 'pdf',
			notebookId: parentNotebookId,
			driveFileId: fileId,
			driveParentFolderId: parentFolderId,
			driveMimeType: 'application/pdf'
		}),
		resolveFolder: vi.fn().mockResolvedValue(nextParentFolderId),
		ensureFolder: vi.fn().mockResolvedValue(item({ id: folderId, parents: [nextParentFolderId] })),
		getItem: vi.fn().mockResolvedValue(item()),
		updateItem: vi.fn().mockResolvedValue(item({ parents: [nextParentFolderId], version: '3' })),
		deleteItem: vi.fn().mockResolvedValue(undefined),
		complete: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		conflict: vi.fn().mockResolvedValue(undefined),
		...overrides
	};
}

function job(overrides: Record<string, unknown> = {}) {
	return parseClaimedDriveJob({
		id: jobId,
		operation: 'move_folder',
		document_id: null,
		notebook_id: notebookId,
		drive_file_id: folderId,
		payload: { parentNotebookId },
		attempt_count: 1,
		lease_expires_at: '2026-08-06T14:10:00.000Z',
		...overrides
	});
}

describe('claimed Drive job contract', () => {
	it('parses and freezes only the supported local operations', () => {
		const parsed = job();

		expect(parsed).toMatchObject({
			id: jobId,
			operation: 'move_folder',
			notebookId,
			driveFileId: folderId,
			attemptCount: 1
		});
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Object.isFrozen(parsed.payload)).toBe(true);
		expect(() => job({ operation: 'upload_file' })).toThrow('Invalid claimed Drive job');
		expect(() => job({ access_token: 'secret' })).toThrow('Invalid claimed Drive job');
		expect(() => job({ payload: { refreshToken: 'secret' } })).toThrow('Invalid claimed Drive job');
	});
});

describe('Drive job executor', () => {
	it('creates an absent notebook folder and completes with its immutable identity', async () => {
		const value = gateway();
		const createJob = job({
			operation: 'create_folder',
			drive_file_id: null,
			payload: { name: 'Biologia', parentNotebookId }
		});

		await expect(executeDriveJob(createJob, value)).resolves.toBe('synced');
		expect(value.resolveFolder).toHaveBeenCalledWith(parentNotebookId);
		expect(value.ensureFolder).toHaveBeenCalledWith('Biologia', nextParentFolderId);
		expect(value.complete).toHaveBeenCalledWith(
			createJob,
			expect.objectContaining({ id: folderId }),
			nextParentFolderId
		);
	});

	it('renames a folder from current local state rather than stale payload', async () => {
		const value = gateway({
			loadNotebook: vi.fn().mockResolvedValue({
				id: notebookId,
				name: 'Ciências Biológicas',
				parentNotebookId,
				driveFolderId: folderId
			}),
			updateItem: vi.fn().mockResolvedValue(item({ name: 'Ciências Biológicas', version: '3' }))
		});
		const renameJob = job({ operation: 'rename_folder', payload: { name: 'Nome antigo' } });

		await expect(executeDriveJob(renameJob, value)).resolves.toBe('synced');
		expect(value.updateItem).toHaveBeenCalledWith({
			fileId: folderId,
			name: 'Ciências Biológicas'
		});
		expect(value.complete).toHaveBeenCalledWith(
			renameJob,
			expect.objectContaining({ name: 'Ciências Biológicas' }),
			parentFolderId
		);
	});

	it('moves a folder or document by current desired notebook parent', async () => {
		const folderGateway = gateway();
		const moveFolderJob = job();
		await expect(executeDriveJob(moveFolderJob, folderGateway)).resolves.toBe('synced');
		expect(folderGateway.getItem).toHaveBeenCalledWith(folderId);
		expect(folderGateway.updateItem).toHaveBeenCalledWith({
			fileId: folderId,
			addParentId: nextParentFolderId,
			removeParentId: parentFolderId
		});

		const documentGateway = gateway({
			getItem: vi.fn().mockResolvedValue(
				item({
					id: fileId,
					name: 'Resumo.pdf',
					mimeType: 'application/pdf',
					parents: [parentFolderId],
					md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e'
				})
			),
			updateItem: vi.fn().mockResolvedValue(
				item({
					id: fileId,
					name: 'Resumo.pdf',
					mimeType: 'application/pdf',
					parents: [nextParentFolderId],
					md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
					version: '3'
				})
			)
		});
		const moveDocumentJob = job({
			operation: 'update_file',
			document_id: documentId,
			notebook_id: null,
			drive_file_id: fileId,
			payload: { notebookId: parentNotebookId }
		});
		await expect(executeDriveJob(moveDocumentJob, documentGateway)).resolves.toBe('synced');
		expect(documentGateway.updateItem).toHaveBeenCalledWith({
			fileId,
			addParentId: nextParentFolderId,
			removeParentId: parentFolderId
		});
	});

	it('skips a redundant move but still publishes fresh metadata', async () => {
		const value = gateway({
			getItem: vi.fn().mockResolvedValue(item({ parents: [nextParentFolderId] }))
		});

		await expect(executeDriveJob(job(), value)).resolves.toBe('synced');
		expect(value.updateItem).not.toHaveBeenCalled();
		expect(value.complete).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ parents: [nextParentFolderId] }),
			nextParentFolderId
		);
	});

	it('deletes file or folder jobs idempotently without a domain row', async () => {
		const value = gateway();
		const deleteJob = job({
			operation: 'delete_permanently',
			notebook_id: null,
			drive_file_id: fileId,
			payload: { targetKind: 'file' }
		});

		await expect(executeDriveJob(deleteJob, value)).resolves.toBe('synced');
		expect(value.deleteItem).toHaveBeenCalledWith(fileId);
		expect(value.complete).toHaveBeenCalledWith(deleteJob, null, null);
	});

	it('isolates multi-parent and identity mismatches as conflicts', async () => {
		const ambiguous = gateway({
			getItem: vi.fn().mockResolvedValue(item({ parents: [parentFolderId, nextParentFolderId] }))
		});
		await expect(executeDriveJob(job(), ambiguous)).resolves.toBe('conflict');
		expect(ambiguous.conflict).toHaveBeenCalledWith(
			expect.anything(),
			'ambiguous_order',
			expect.any(Object),
			expect.any(Object)
		);
		expect(ambiguous.updateItem).not.toHaveBeenCalled();

		const mismatch = gateway({
			getItem: vi.fn().mockResolvedValue(item({ mimeType: 'application/pdf' }))
		});
		await expect(executeDriveJob(job(), mismatch)).resolves.toBe('conflict');
		expect(mismatch.conflict).toHaveBeenCalledWith(
			expect.anything(),
			'identity_mismatch',
			expect.any(Object),
			expect.any(Object)
		);
	});

	it('retries unresolved parents and provider failures with sanitized messages', async () => {
		const pending = gateway({
			resolveFolder: vi.fn().mockRejectedValue(new Error('parent not synchronized'))
		});
		await expect(executeDriveJob(job(), pending)).resolves.toBe('retryable');
		expect(pending.retry).toHaveBeenCalledWith(
			expect.anything(),
			'drive_dependency_pending',
			'A pasta de destino ainda não está sincronizada.'
		);

		const provider = gateway({
			getItem: vi.fn().mockRejectedValue(new Error('Bearer secret-provider-body'))
		});
		await expect(executeDriveJob(job(), provider)).resolves.toBe('retryable');
		expect(provider.retry).toHaveBeenCalledWith(
			expect.anything(),
			'drive_request_failed',
			'O Google Drive não concluiu a operação. Uma nova tentativa será feita.'
		);
	});
});
