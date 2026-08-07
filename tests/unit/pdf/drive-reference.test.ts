import { describe, expect, it, vi } from 'vitest';
import { stageDrivePdfReference } from '../../../src/lib/pdf/drive-reference';
import type { DriveFile } from '../../../src/lib/drive/types';
import type { GooglePickerSelection } from '../../../src/lib/drive/picker';

const notebookId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sourceFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const copiedFileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const parentFolderId = '0ALargePdfFolderId_123456789';

const selection: GooglePickerSelection = {
	id: sourceFileId,
	name: 'Apostila grande.pdf',
	mimeType: 'application/pdf',
	sizeBytes: 120 * 1024 * 1024,
	modifiedAt: '2026-08-05T12:00:00.000Z'
};

const copied: DriveFile = {
	id: copiedFileId,
	name: selection.name,
	mimeType: 'application/pdf',
	parents: [parentFolderId],
	modifiedTime: '2026-08-07T10:00:00.000Z',
	version: '2',
	md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
	trashed: false
};

function dependencies() {
	return {
		createDocumentId: vi.fn(() => documentId),
		resolveFolder: vi.fn().mockResolvedValue(parentFolderId),
		copyFile: vi.fn().mockResolvedValue(copied),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		stage: vi.fn().mockResolvedValue({
			documentId,
			driveFileId: copiedFileId,
			sourceSizeBytes: selection.sizeBytes,
			status: 'pending_inspection'
		})
	};
}

describe('stageDrivePdfReference', () => {
	it('copies an oversized Picker PDF into the controlled folder and persists only its reference', async () => {
		const deps = dependencies();

		await expect(
			stageDrivePdfReference({
				selection,
				notebookId,
				title: 'Apostila grande',
				client: {} as never,
				dependencies: deps
			})
		).resolves.toEqual({
			documentId,
			driveFileId: copiedFileId,
			sourceSizeBytes: selection.sizeBytes,
			status: 'pending_inspection'
		});

		expect(deps.resolveFolder).toHaveBeenCalledWith(notebookId, expect.anything());
		expect(deps.copyFile).toHaveBeenCalledWith(
			expect.objectContaining({
				client: expect.anything(),
				sourceFileId,
				parentFolderId,
				name: selection.name,
				appProperties: {
					ficharioPurpose: 'oversized_pdf_reference',
					ficharioDocumentId: documentId
				}
			})
		);
		expect(deps.stage).toHaveBeenCalledWith(
			expect.objectContaining({
				client: expect.anything(),
				targetDocumentId: documentId,
				targetNotebookId: notebookId,
				documentTitle: 'Apostila grande',
				originalFilename: selection.name,
				targetDriveFileId: copiedFileId,
				targetDriveParentFolderId: parentFolderId,
				targetDriveModifiedTime: copied.modifiedTime,
				targetDriveVersion: copied.version,
				targetDriveMd5Checksum: copied.md5Checksum,
				sourceSizeBytes: selection.sizeBytes,
				sourceModifiedAt: selection.modifiedAt
			})
		);
		expect(deps.deleteFile).not.toHaveBeenCalled();
	});

	it('deletes the copied Drive file when durable staging fails', async () => {
		const deps = dependencies();
		deps.stage.mockRejectedValue(new Error('rpc failed'));

		await expect(
			stageDrivePdfReference({
				selection,
				notebookId,
				title: 'Apostila grande',
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Não foi possível preparar o PDF grande para importação.');
		expect(deps.deleteFile).toHaveBeenCalledWith(
			expect.objectContaining({ client: expect.anything(), fileId: copiedFileId })
		);
	});

	it('rejects a non-PDF selection before creating Drive side effects', async () => {
		const deps = dependencies();
		const image = { ...selection, mimeType: 'image/png' as const };

		await expect(
			stageDrivePdfReference({
				selection: image,
				notebookId,
				title: 'Imagem',
				client: {} as never,
				dependencies: deps
			})
		).rejects.toThrow('Invalid Drive PDF reference');
		expect(deps.resolveFolder).not.toHaveBeenCalled();
		expect(deps.copyFile).not.toHaveBeenCalled();
		expect(deps.stage).not.toHaveBeenCalled();
	});
});
