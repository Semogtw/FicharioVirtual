import { describe, expect, it, vi } from 'vitest';
import {
	uploadPreparedImageToDriveWithGateway,
	type DriveImageImportGateway,
	type DriveImageUploadDependencies
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
		original: new File(['source'], 'scan.png', { type: 'image/png' }),
		image: new Blob(['image'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
		width: 1200,
		height: 900,
		format: 'image/webp',
		preprocessing: {
			profile: 'ocr_clean_v1',
			version: 1,
			autoCropApplied: true,
			retainedAreaPermille: 900,
			deskewMilliDegrees: -500,
			illuminationNormalized: true,
			contrastEnhanced: false,
			fallbackToStandard: false,
			sourceWidth: 1800,
			sourceHeight: 1400,
			preparedWidth: 1200,
			preparedHeight: 900
		},
		originalName: 'scan.png',
		originalBytes: 6,
		preparedBytes: 10
	};
}

function driveFile() {
	return {
		id: driveFileId,
		name: 'scan.png',
		mimeType: 'image/png',
		parents: [folderId],
		modifiedTime: '2026-08-06T09:00:00.000Z',
		version: '5',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

function fixture({ failTemporary = false, failMetadata = false } = {}) {
	const uploadedTemporary: string[] = [];
	const uploadedOriginal: Array<{ blob: Blob; name: string; parentFolderId: string }> = [];
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
		async uploadOriginal(blob, name, parentFolderId) {
			uploadedOriginal.push({ blob, name, parentFolderId });
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
		uploadedOriginal,
		removedTemporary,
		deletedDrive,
		get publication() {
			return publication;
		}
	};
}

function dependencies(): DriveImageUploadDependencies {
	return {
		async calculateSha256() {
			return 'a'.repeat(64);
		},
		generateUuid: vi
			.fn()
			.mockReturnValueOnce(documentId)
			.mockReturnValueOnce(pageId)
			.mockReturnValueOnce(jobId)
	};
}

describe('Drive-first image upload', () => {
	it('keeps the raw source in Drive and uploads only OCR derivatives temporarily', async () => {
		const value = fixture();
		const source = prepared();

		const result = await uploadPreparedImageToDriveWithGateway(
			{ prepared: source, notebookId: null },
			value.gateway,
			dependencies()
		);

		expect(value.uploadedOriginal).toHaveLength(1);
		expect(value.uploadedOriginal[0]).toEqual({
			blob: source.original,
			name: 'scan.png',
			parentFolderId: folderId
		});
		expect(value.uploadedTemporary).toEqual([
			`${userId}/${documentId}/ocr.webp`,
			`${userId}/${documentId}/thumbnail.jpg`
		]);
		expect(value.publication).toMatchObject({
			documentId,
			pageId,
			ocrJobId: jobId,
			notebookId: null,
			driveFile: driveFile(),
			ocrPath: `${userId}/${documentId}/ocr.webp`,
			thumbnailPath: `${userId}/${documentId}/thumbnail.jpg`,
			preparedSha256: 'a'.repeat(64),
			sourceSha256: 'a'.repeat(64),
			preprocessing: expect.objectContaining({ profile: 'ocr_clean_v1', version: 1 })
		});
		expect(result).toEqual({
			documentId,
			pageId,
			ocrJobId: jobId,
			sha256: 'a'.repeat(64),
			storagePath: `drive:${driveFileId}`,
			thumbnailPath: `${userId}/${documentId}/thumbnail.jpg`
		});
	});

	it('deletes the Drive original when temporary upload or metadata publication fails', async () => {
		const temporary = fixture({ failTemporary: true });
		await expect(
			uploadPreparedImageToDriveWithGateway(
				{ prepared: prepared() },
				temporary.gateway,
				dependencies()
			)
		).rejects.toThrow('temporary failed');
		expect(temporary.deletedDrive).toEqual([driveFileId]);

		const metadata = fixture({ failMetadata: true });
		await expect(
			uploadPreparedImageToDriveWithGateway(
				{ prepared: prepared() },
				metadata.gateway,
				dependencies()
			)
		).rejects.toThrow('metadata failed');
		expect(metadata.removedTemporary).toEqual([
		[
			`${userId}/${documentId}/ocr.webp`,
			`${userId}/${documentId}/thumbnail.jpg`
		]
	]);
		expect(metadata.deletedDrive).toEqual([driveFileId]);
	});

	it('rejects duplicates before resolving a folder or uploading', async () => {
		const value = fixture();
		value.gateway.findDuplicate = async () => documentId;
		const resolve = vi.spyOn(value.gateway, 'resolveFolder');
		const upload = vi.spyOn(value.gateway, 'uploadOriginal');

		await expect(
			uploadPreparedImageToDriveWithGateway({ prepared: prepared() }, value.gateway, dependencies())
		).rejects.toMatchObject({ name: 'DuplicateImageError', documentId });
		expect(resolve).not.toHaveBeenCalled();
		expect(upload).not.toHaveBeenCalled();
	});
});
