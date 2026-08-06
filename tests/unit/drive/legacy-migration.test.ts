import { describe, expect, it, vi } from 'vitest';
import {
	listLegacyDriveDocuments,
	migrateLegacyDriveDocumentWithGateway,
	parseLegacyDriveDocuments,
	type LegacyDriveMigrationGateway
} from '../../../src/lib/drive/legacy-migration';

const documentId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';
const folderId = '0AParentFolderId_123456789';
const driveFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const storagePath = `33333333-3333-4333-8333-333333333333/${documentId}/original.pdf`;

const legacy = {
	id: documentId,
	title: 'Apostila',
	kind: 'pdf',
	original_filename: 'apostila.pdf',
	storage_path: storagePath,
	notebook_id: notebookId,
	created_at: '2026-08-05T10:00:00.000Z'
};

function driveFile() {
	return {
		id: driveFileId,
		name: 'apostila.pdf',
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: '2026-08-06T12:00:00.000Z',
		version: '1',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('legacy Drive migration contracts', () => {
	it('parses only unmigrated private Storage originals', () => {
		const result = parseLegacyDriveDocuments([legacy]);

		expect(result).toEqual([
			{
				id: documentId,
				title: 'Apostila',
				kind: 'pdf',
				originalFilename: 'apostila.pdf',
				storagePath,
				notebookId,
				createdAt: '2026-08-05T10:00:00.000Z'
			}
		]);
		expect(Object.isFrozen(result)).toBe(true);
		expect(() => parseLegacyDriveDocuments([{ ...legacy, service_role: 'secret' }])).toThrow(
			'Invalid legacy Drive migration response'
		);
		expect(() => parseLegacyDriveDocuments([legacy, legacy])).toThrow(
			'Invalid legacy Drive migration response'
		);
	});

	it('loads only rows that still have Storage but no Drive identity', async () => {
		const order = vi.fn().mockResolvedValue({ data: [legacy], error: null });
		const isDriveNull = vi.fn(() => ({ order }));
		const notStorageNull = vi.fn(() => ({ is: isDriveNull }));
		const select = vi.fn(() => ({ not: notStorageNull }));
		const from = vi.fn(() => ({ select }));

		await expect(listLegacyDriveDocuments({ from } as never)).resolves.toEqual(
			parseLegacyDriveDocuments([legacy])
		);
		expect(from).toHaveBeenCalledWith('documents');
		expect(select).toHaveBeenCalledWith(
			'id,title,kind,original_filename,storage_path,notebook_id,created_at'
		);
		expect(notStorageNull).toHaveBeenCalledWith('storage_path', 'is', null);
		expect(isDriveNull).toHaveBeenCalledWith('drive_file_id', null);
	});
});

describe('legacy Drive migration runner', () => {
	function gateway(overrides: Partial<LegacyDriveMigrationGateway> = {}) {
		return {
			downloadLegacyOriginal: vi
				.fn()
				.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' })),
			resolveFolder: vi.fn().mockResolvedValue(folderId),
			uploadOriginal: vi.fn().mockResolvedValue(driveFile()),
			publishMigration: vi.fn().mockResolvedValue(undefined),
			deleteDriveFile: vi.fn().mockResolvedValue(undefined),
			...overrides
		} satisfies LegacyDriveMigrationGateway;
	}

	it('copies the original to Drive and retains the legacy object as fallback', async () => {
		const value = gateway();

		await expect(
			migrateLegacyDriveDocumentWithGateway(parseLegacyDriveDocuments([legacy])[0], value)
		).resolves.toEqual(driveFile());
		expect(value.downloadLegacyOriginal).toHaveBeenCalledWith(storagePath);
		expect(value.resolveFolder).toHaveBeenCalledWith(notebookId);
		expect(value.uploadOriginal).toHaveBeenCalledWith(
			expect.any(File),
			'apostila.pdf',
			folderId,
			documentId
		);
		expect(value.publishMigration).toHaveBeenCalledWith({
			documentId,
			storagePath,
			file: driveFile()
		});
		expect(value.deleteDriveFile).not.toHaveBeenCalled();
	});

	it('deletes the new Drive copy when atomic publication fails', async () => {
		const value = gateway({
			publishMigration: vi.fn().mockRejectedValue(new Error('database unavailable'))
		});

		await expect(
			migrateLegacyDriveDocumentWithGateway(parseLegacyDriveDocuments([legacy])[0], value)
		).rejects.toThrow('database unavailable');
		expect(value.deleteDriveFile).toHaveBeenCalledWith(driveFileId);
	});

	it('rejects empty or mismatched Storage objects before upload', async () => {
		const empty = gateway({ downloadLegacyOriginal: vi.fn().mockResolvedValue(new Blob([])) });
		await expect(
			migrateLegacyDriveDocumentWithGateway(parseLegacyDriveDocuments([legacy])[0], empty)
		).rejects.toThrow('O original legado não corresponde ao documento.');
		expect(empty.uploadOriginal).not.toHaveBeenCalled();

		const wrongType = gateway({
			downloadLegacyOriginal: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/webp' }))
		});
		await expect(
			migrateLegacyDriveDocumentWithGateway(parseLegacyDriveDocuments([legacy])[0], wrongType)
		).rejects.toThrow('O original legado não corresponde ao documento.');
		expect(wrongType.uploadOriginal).not.toHaveBeenCalled();
	});
});
