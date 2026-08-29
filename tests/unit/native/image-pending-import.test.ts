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
			autoCropApplied: false,
			retainedAreaPermille: 1000,
			deskewMilliDegrees: 0,
			illuminationNormalized: false,
			contrastEnhanced: false,
			fallbackToStandard: false,
			sourceWidth: 1200,
			sourceHeight: 900,
			preparedWidth: 1200,
			preparedHeight: 900
		},
		originalName: 'scan.png',
		originalBytes: 6,
		preparedBytes: 5
	};
}

describe('native pending image identity', () => {
	it('publishes a pre-persisted image with the same document id', async () => {
		let publishedDocumentId: string | null = null;
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
				return {
					id: driveFileId,
					name: 'scan.png',
					mimeType: 'image/png',
					parents: [folderId],
					modifiedTime: '2026-08-20T00:00:00.000Z',
					version: '1',
					md5Checksum: null,
					trashed: false
				};
			},
			async uploadTemporary() {},
			async removeTemporary() {},
			async deleteDriveFile() {},
			async createImport(input) {
				publishedDocumentId = input.documentId;
				return { documentId: input.documentId, pageId, ocrJobId: jobId };
			}
		};
		const dependencies: DriveImageUploadDependencies = {
			async calculateSha256() {
				return 'a'.repeat(64);
			},
			generateUuid: vi.fn().mockReturnValueOnce(pageId).mockReturnValueOnce(jobId)
		};

		const result = await uploadPreparedImageToDriveWithGateway(
			{ prepared: prepared(), nativeDocumentId: documentId },
			gateway,
			dependencies
		);

		expect(publishedDocumentId).toBe(documentId);
		expect(result.documentId).toBe(documentId);
		expect(dependencies.generateUuid).toHaveBeenCalledTimes(2);
	});
});
