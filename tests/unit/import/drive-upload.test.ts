import { describe, expect, it, vi } from 'vitest';
import {
	uploadPreparedImageToDriveWithGateway,
	type DriveImageImportGateway
} from '../../../src/lib/import/drive-upload';
import type { PreparedImage } from '../../../src/lib/import/image-types';

const userId = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const pageId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const folderId = '0AParentFolderId_123456789';
const driveFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function prepared(): PreparedImage {
	return {
		image: new Blob(['image'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
		width: 1200,
		height: 900,
		format: 'image/webp',
		originalName: 'scan.png',
		originalBytes: 100,
		preparedBytes: 10
	};
}

function driveFile() {
	return {
		id: driveFileId,
		name: 'scan.webp',
		mimeType: 'image/webp',
		parents: [folderId],
		modifiedTime: '2026-08-06T09:00:00.000Z',
		version: '5',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

function fixture({ failTemporary = false, failMetadata = false } = {}) {
	const uploadedTemporary: string[] = [];
	const removedTemporary: string[][] = [];
	const deletedDrive: string[] = [];
	let publication: Record<string, unknown> | null = null;
	const gateway: DriveImageImportGateway = {
		async currentUserId() {
			return userId;
		},
		async findDuplicate() {
			return null;
		},
		async resolveFolder() {
			return folderId;
		},
		async uploadOriginal() {
			return driveFile();
		},
		async uploadTemporary(path) {
			uploadedTemporary.push(path);
			if (failTemporary) throw new Error('temporary failed');
		},
		async removeTemporary(paths) {
			removedTemporary.push([...paths]);
		},
		async deleteDriveFile(fileId) {
			deletedDrive.push(fileId);
		},
		async createImport(input) {
			publication = input as unknown as Record<string, unknown>;
			if (failMetadata) throw new Error('metadata failed');
			return { documentId, pageId, ocrJobId: jobId };
		}
	};
	return {
		gateway,
		uploadedTemporary,
		removedTemporary,
		deletedDrive,
		get publication() {
			return publication;
		}
	};
}

const dependencies = {
	async calculateSha256() {
		return 'a'.repeat(64);
	},
	generateUuid: vi
		.fn()
		.mockReturnValueOnce(documentId)
		.mockReturnValueOnce(pageId)
		.mockReturnValueOnce(jobId)
};

describe('Drive-first image upload', () => {
	it('uploads the original only to Drive and publishes strict metadata', async () => {
		const value = fixture();

		const result = await uploadPreparedImageToDriveWithGateway(
			{ prepared: prepared(), notebookId: null },
			value.gateway,
			dependencies
		);

		expect(value.uploadedTemporary).toEqual([
			`${userId}/${documentId}/thumbnail.jpg`
		]);
		expect(value.publication).toMatchObject({
			documentId,
			pageId,
			ocrJobId: jobId,
			notebookId: null,
			driveFile: driveFile(),
			thumbnailPath: `${userId}/${documentId}/thumbnail.jpg`,
			sha256: 'a'.repeat(64)
		});
		expect(result).toEqual({
			documentId,
			pageId,
			ocrJobId: jobId,
			sha256: 'a'.repeat(64),
			storagePath: `drive:${driveFileId}`,
			thumbnailPath: `${userId}/${documentId}/thumbnail.jpg`,
			driveFileId
		});
	});

	it('deletes the Drive original when temporary upload or metadata publication fails', async () => {
		const temporary = fixture({ failTemporary: true });
		await expect(
			uploadPreparedImageToDriveWithGateway(
				{ prepared: prepared() },
				temporary.gateway,
				{
					...dependencies,
					generateUuid: vi
						.fn()
						.mockReturnValueOnce(documentId)
						.mockReturnValueOnce(pageId)
						.mockReturnValueOnce(jobId)
				}
			)
		).rejects.toThrow('temporary failed');
		expect(temporary.deletedDrive).toEqual([driveFileId]);

		const metadata = fixture({ failMetadata: true });
		await expect(
			uploadPreparedImageToDriveWithGateway(
				{ prepared: prepared() },
				metadata.gateway,
				{
					...dependencies,
					generateUuid: vi
						.fn()
						.mockReturnValueOnce(documentId)
						.mockReturnValueOnce(pageId)
						.mockReturnValueOnce(jobId)
				}
			)
		).rejects.toThrow('metadata failed');
		expect(metadata.removedTemporary).toEqual([
			[`${userId}/${documentId}/thumbnail.jpg`]
		]);
		expect(metadata.deletedDrive).toEqual([driveFileId]);
	});

	it('rejects duplicates before resolving a folder or uploading', async () => {
		const value = fixture();
		value.gateway.findDuplicate = async () => documentId;
		const resolve = vi.spyOn(value.gateway, 'resolveFolder');
		const upload = vi.spyOn(value.gateway, 'uploadOriginal');

		await expect(
			uploadPreparedImageToDriveWithGateway(
				{ prepared: prepared() },
				value.gateway,
				dependencies
			)
		).rejects.toMatchObject({ name: 'DuplicateImageError', documentId });
		expect(resolve).not.toHaveBeenCalled();
		expect(upload).not.toHaveBeenCalled();
	});
});
