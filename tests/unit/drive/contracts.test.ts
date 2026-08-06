import { describe, expect, it } from 'vitest';
import {
	parseDriveChangePage,
	parseDriveFile,
	parseDriveFileList
} from '../../../src/lib/drive/contracts';
import {
	DRIVE_FILE_SCOPE,
	childFolderQuery,
	rootFolderQuery
} from '../../../src/lib/drive/queries';
import { reconcileDrivePresence } from '../../../src/lib/drive/reconciliation';

const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const otherFileId = '9ZyXwVuTsRqPoNmLkJiHgFeDcBa_654321';
const folderId = '0AExampleRootFolderId_123456789';

function driveFile(overrides: Record<string, unknown> = {}) {
	return {
		id: fileId,
		name: 'Fotossíntese.pdf',
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: '2026-08-06T02:00:00.000Z',
		version: '7',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false,
		...overrides
	};
}

const documentSnapshot = {
	id: '11111111-1111-4111-8111-111111111111',
	driveFileId: fileId,
	physicalState: 'available' as const,
	title: 'Fotossíntese',
	notebookId: '22222222-2222-4222-8222-222222222222',
	tags: ['biologia'],
	ocrText: 'A fotossíntese ocorre nos cloroplastos.',
	correctedText: 'A fotossíntese acontece nos cloroplastos.',
	driveModifiedTime: '2026-08-06T01:00:00.000Z',
	driveVersion: '6'
};

describe('Google Drive response contracts', () => {
	it('accepts and freezes an exact Drive file response', () => {
		const result = parseDriveFile(driveFile());

		expect(result).toEqual(driveFile());
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(result.parents)).toBe(true);
	});

	it('rejects malformed or extra file fields', () => {
		expect(() => parseDriveFile(driveFile({ id: '' }))).toThrow('Invalid Drive file response');
		expect(() => parseDriveFile(driveFile({ version: 7 }))).toThrow(
			'Invalid Drive file response'
		);
		expect(() => parseDriveFile(driveFile({ accessToken: 'must-not-pass' }))).toThrow(
			'Invalid Drive file response'
		);
	});

	it('rejects duplicate IDs in file listings', () => {
		expect(() =>
			parseDriveFileList({ files: [driveFile(), driveFile()], nextPageToken: null })
		).toThrow('Invalid Drive file list response');
	});

	it('parses paginated changes and rejects duplicate change identities', () => {
		const page = parseDriveChangePage({
			changes: [
				{ fileId, removed: false, file: driveFile() },
				{ fileId: otherFileId, removed: true }
			],
			nextPageToken: 'next-page-token',
			newStartPageToken: null
		});

		expect(page.changes).toHaveLength(2);
		expect(page.nextPageToken).toBe('next-page-token');
		expect(Object.isFrozen(page)).toBe(true);
		expect(() =>
			parseDriveChangePage({
				changes: [
					{ fileId, removed: true },
					{ fileId, removed: true }
				],
				nextPageToken: null,
				newStartPageToken: 'new-start-token'
			})
		).toThrow('Invalid Drive change response');
	});
});

describe('Drive reconciliation', () => {
	it('marks a removed physical file missing without erasing searchable metadata', () => {
		const result = reconcileDrivePresence(documentSnapshot, { fileId, removed: true });

		expect(result).toMatchObject({
			physicalState: 'missing',
			title: documentSnapshot.title,
			notebookId: documentSnapshot.notebookId,
			tags: documentSnapshot.tags,
			ocrText: documentSnapshot.ocrText,
			correctedText: documentSnapshot.correctedText
		});
		expect(result.conflict).toBeNull();
	});

	it('reconnects the same Drive file identity', () => {
		const result = reconcileDrivePresence(
			{ ...documentSnapshot, physicalState: 'missing' },
			{ fileId, removed: false, file: driveFile() }
		);

		expect(result.physicalState).toBe('available');
		expect(result.driveVersion).toBe('7');
		expect(result.driveModifiedTime).toBe('2026-08-06T02:00:00.000Z');
		expect(result.conflict).toBeNull();
	});

	it('isolates a mismatched physical identity as a conflict', () => {
		const result = reconcileDrivePresence(documentSnapshot, {
			fileId: otherFileId,
			removed: false,
			file: driveFile({ id: otherFileId })
		});

		expect(result.physicalState).toBe('available');
		expect(result.driveFileId).toBe(fileId);
		expect(result.conflict).toEqual({
			kind: 'identity_mismatch',
			remoteFileId: otherFileId
		});
	});
});

describe('Drive authorization and folder queries', () => {
	it('uses only the approved drive.file scope', () => {
		expect(DRIVE_FILE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
	});

	it('builds escaped root and child folder queries', () => {
		expect(rootFolderQuery("Fichário D'igital")).toBe(
			"name = 'Fichário D\\'igital' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
		);
		expect(childFolderQuery(folderId, 'Biologia')).toBe(
			`name = 'Biologia' and mimeType = 'application/vnd.google-apps.folder' and '${folderId}' in parents and trashed = false`
		);
	});
});
