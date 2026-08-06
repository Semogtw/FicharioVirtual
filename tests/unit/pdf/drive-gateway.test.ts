import { describe, expect, it, vi } from 'vitest';
import { createDrivePdfGateway, type DrivePdfOperations } from '../../../src/lib/pdf/drive-upload';

const userId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const notebookId = '33333333-3333-4333-8333-333333333333';
const folderId = '0AParentFolderId_123456789';
const driveFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function driveFile() {
	return {
		id: driveFileId,
		name: 'apostila.pdf',
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: '2026-08-06T09:30:00.000Z',
		version: '4',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

function fixture() {
	const upload = vi.fn().mockResolvedValue({ error: null });
	const remove = vi.fn().mockResolvedValue({ error: null });
	const rpc = vi.fn().mockImplementation(async (_name: string, args: Record<string, unknown>) => ({
		data: {
			documentId: args.target_document_id,
			pageCount: 1,
			ocrPageCount: 1,
			reviewPageCount: 0,
			status: 'processing'
		},
		error: null
	}));
	const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
	const client = {
		auth: {
			getSession: vi.fn().mockResolvedValue({
				data: { session: { user: { id: userId } } },
				error: null
			})
		},
		from: vi.fn(() => ({
			select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }))
		})),
		storage: { from: vi.fn(() => ({ upload, remove })) },
		rpc
	};
	const operations: DrivePdfOperations = {
		resolveFolder: vi.fn().mockResolvedValue(folderId),
		uploadOriginal: vi.fn().mockResolvedValue(driveFile()),
		deleteDriveFile: vi.fn().mockResolvedValue(undefined)
	};
	return { client, operations, upload, remove, rpc };
}

describe('Drive PDF gateway', () => {
	it('routes only the permanent original to Drive and publishes Drive metadata', async () => {
		const value = fixture();
		const gateway = createDrivePdfGateway(value.client as never, notebookId, value.operations);
		const originalPath = `${userId}/${documentId}/original.pdf`;
		const temporaryPath = `${userId}/${documentId}/pages/1.webp`;

		await gateway.upload(
			originalPath,
			new File(['pdf'], 'apostila.pdf', { type: 'application/pdf' })
		);
		await gateway.upload(temporaryPath, new Blob(['page'], { type: 'image/webp' }));
		const publication = await gateway.createImport({
			documentId,
			notebookId,
			title: 'Apostila',
			originalFilename: 'apostila.pdf',
			originalStoragePath: originalPath,
			sha256: 'a'.repeat(64),
			sourceCreatedAt: null,
			pages: [
				{
					id: '44444444-4444-4444-8444-444444444444',
					pageNumber: 1,
					nativeText: null,
					needsOcr: true,
					temporaryImagePath: temporaryPath,
					jobId: '55555555-5555-4555-8555-555555555555'
				}
			],
			promptVersion: 1
		});

		expect(value.operations.resolveFolder).toHaveBeenCalledWith(notebookId);
		expect(value.operations.uploadOriginal).toHaveBeenCalledWith(
			expect.any(File),
			'apostila.pdf',
			folderId
		);
		expect(value.upload).toHaveBeenCalledTimes(1);
		expect(value.upload).toHaveBeenCalledWith(
			temporaryPath,
			expect.any(Blob),
			expect.objectContaining({ contentType: 'image/webp' })
		);
		expect(value.rpc).toHaveBeenCalledWith(
			'create_drive_pdf_import',
			expect.objectContaining({
				target_document_id: documentId,
				target_drive_file_id: driveFileId,
				target_drive_parent_folder_id: folderId,
				page_descriptors: expect.any(Array)
			})
		);
		expect(publication.status).toBe('processing');
	});

	it('removes temporary artifacts and the Drive original during rollback', async () => {
		const value = fixture();
		const gateway = createDrivePdfGateway(value.client as never, notebookId, value.operations);
		const originalPath = `${userId}/${documentId}/original.pdf`;
		const temporaryPath = `${userId}/${documentId}/pages/1.webp`;
		await gateway.upload(
			originalPath,
			new File(['pdf'], 'apostila.pdf', { type: 'application/pdf' })
		);

		await gateway.remove([originalPath, temporaryPath]);

		expect(value.operations.deleteDriveFile).toHaveBeenCalledWith(driveFileId);
		expect(value.remove).toHaveBeenCalledWith([temporaryPath]);
	});
});
