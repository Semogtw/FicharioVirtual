import { describe, expect, it, vi } from 'vitest';
import {
	listDriveRecovery,
	parseMissingDriveDocuments,
	parseOpenDriveConflicts,
	reconnectMissingDriveDocument
} from '../../../src/lib/drive/recovery';

const documentId = '11111111-1111-4111-8111-111111111111';
const conflictId = '22222222-2222-4222-8222-222222222222';
const notebookId = '33333333-3333-4333-8333-333333333333';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const folderId = '0AParentFolderId_123456789';

const missing = {
	id: documentId,
	title: 'Fotossíntese',
	kind: 'image',
	original_filename: 'fotossintese.webp',
	notebook_id: notebookId,
	drive_file_id: fileId,
	updated_at: '2026-08-06T10:00:00.000Z'
};

const conflict = {
	id: conflictId,
	document_id: documentId,
	notebook_id: null,
	kind: 'ambiguous_order',
	local_snapshot: { documentId, notebookId },
	remote_snapshot: { fileId, parentFolderId: '0AUnknownFolderId_123456789' },
	created_at: '2026-08-06T10:05:00.000Z'
};

function queryResult(data: unknown, error: unknown = null) {
	const order = vi.fn().mockResolvedValue({ data, error });
	const is = vi.fn(() => ({ order }));
	const eq = vi.fn(() => ({ order, is }));
	const select = vi.fn(() => ({ eq, order, is }));
	return { select, eq, is, order };
}

describe('Drive recovery contracts', () => {
	it('parses missing documents and open conflicts without accepting secret fields', () => {
		const documents = parseMissingDriveDocuments([missing]);
		const conflicts = parseOpenDriveConflicts([conflict]);

		expect(documents).toEqual([
			{
				id: documentId,
				title: 'Fotossíntese',
				kind: 'image',
				originalFilename: 'fotossintese.webp',
				notebookId,
				driveFileId: fileId,
				updatedAt: '2026-08-06T10:00:00.000Z'
			}
		]);
		expect(conflicts[0]).toMatchObject({
			id: conflictId,
			documentId,
			kind: 'ambiguous_order'
		});
		expect(Object.isFrozen(documents)).toBe(true);
		expect(Object.isFrozen(conflicts[0].remoteSnapshot)).toBe(true);
		expect(() => parseMissingDriveDocuments([{ ...missing, access_token: 'secret' }])).toThrow(
			'Invalid Drive recovery response'
		);
		expect(() =>
			parseOpenDriveConflicts([{ ...conflict, refresh_token: 'secret' }])
		).toThrow('Invalid Drive recovery response');
	});

	it('rejects duplicate IDs, malformed snapshots, and unbounded responses', () => {
		expect(() => parseMissingDriveDocuments([missing, missing])).toThrow(
			'Invalid Drive recovery response'
		);
		expect(() => parseOpenDriveConflicts([{ ...conflict, remote_snapshot: ['bad'] }])).toThrow(
			'Invalid Drive recovery response'
		);
		expect(() => parseMissingDriveDocuments(Array.from({ length: 101 }, () => missing))).toThrow(
			'Invalid Drive recovery response'
		);
	});
});

describe('Drive recovery service', () => {
	it('loads only missing documents and unresolved conflicts', async () => {
		const documentQuery = queryResult([missing]);
		const conflictQuery = queryResult([conflict]);
		const from = vi.fn((table: string) => {
			if (table === 'documents') return documentQuery;
			if (table === 'drive_conflicts') return conflictQuery;
			throw new Error('unexpected table');
		});

		await expect(listDriveRecovery({ from } as never)).resolves.toEqual({
			missingDocuments: parseMissingDriveDocuments([missing]),
			openConflicts: parseOpenDriveConflicts([conflict])
		});
		expect(documentQuery.select).toHaveBeenCalledWith(
			'id,title,kind,original_filename,notebook_id,drive_file_id,updated_at'
		);
		expect(documentQuery.eq).toHaveBeenCalledWith('physical_state', 'missing');
		expect(conflictQuery.select).toHaveBeenCalledWith(
			'id,document_id,notebook_id,kind,local_snapshot,remote_snapshot,created_at'
		);
		expect(conflictQuery.is).toHaveBeenCalledWith('resolved_at', null);
	});

	it('reconnects a missing record through the strict RPC and rejects malformed receipts', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
		const client = { rpc };
		await expect(
			reconnectMissingDriveDocument(
				{
					documentId,
					file: {
						id: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
						name: 'novo-original.webp',
						mimeType: 'image/webp',
						parents: [folderId],
						modifiedTime: '2026-08-06T11:00:00.000Z',
						version: '1',
						md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
						trashed: false
					}
				},
				client as never
			)
		).resolves.toBeUndefined();
		expect(rpc).toHaveBeenCalledWith('reconnect_missing_drive_document', {
			target_document_id: documentId,
			target_drive_file_id: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
			target_drive_parent_folder_id: folderId,
			target_drive_mime_type: 'image/webp',
			target_drive_modified_time: '2026-08-06T11:00:00.000Z',
			target_drive_version: '1',
			target_drive_md5_checksum: 'd41d8cd98f00b204e9800998ecf8427e'
		});

		rpc.mockResolvedValueOnce({ data: false, error: null });
		await expect(
			reconnectMissingDriveDocument(
				{
					documentId,
					file: {
						id: '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
						name: 'novo-original.webp',
						mimeType: 'image/webp',
						parents: [folderId],
						modifiedTime: '2026-08-06T11:00:00.000Z',
						version: '1',
						md5Checksum: null,
						trashed: false
					}
				},
				client as never
			)
		).rejects.toThrow('Não foi possível reconectar o original no Google Drive.');
	});
});
