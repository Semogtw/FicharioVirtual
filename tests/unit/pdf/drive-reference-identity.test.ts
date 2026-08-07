import { describe, expect, it, vi } from 'vitest';
import {
	DrivePdfReferenceChangedError,
	verifyDrivePdfReferenceIdentity
} from '../../../src/lib/pdf/drive-reference-identity';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const parentFolderId = '0ARootFolderId_123456789';
const sourceSizeBytes = 70 * 1024 * 1024;
type IdentityClient = Parameters<typeof verifyDrivePdfReferenceIdentity>[0]['client'];

function rpcIdentity() {
	return {
		documentId,
		driveFileId: fileId,
		driveParentFolderId: parentFolderId,
		driveMimeType: 'application/pdf',
		driveModifiedTime: '2026-08-07T18:30:00+00:00',
		driveVersion: '4',
		driveMd5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		sourceSizeBytes
	};
}

function liveMetadata() {
	return {
		id: fileId,
		name: 'Apostila grande.pdf',
		mimeType: 'application/pdf',
		parents: [parentFolderId],
		modifiedTime: '2026-08-07T18:30:00.000Z',
		version: '4',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

function client(data: unknown = rpcIdentity(), error: unknown = null): IdentityClient {
	return {
		functions: {
			invoke: vi.fn().mockResolvedValue({ data: null, error: null })
		},
		rpc: vi.fn().mockResolvedValue({ data, error })
	};
}

describe('verifyDrivePdfReferenceIdentity', () => {
	it('accepts only the exact staged physical identity before range reads', async () => {
		const getMetadata = vi.fn().mockResolvedValue(liveMetadata());
		const db = client();

		await expect(
			verifyDrivePdfReferenceIdentity({
				client: db,
				documentId,
				driveFileId: fileId,
				sourceSizeBytes,
				dependencies: { getMetadata }
			})
		).resolves.toEqual({ driveVersion: '4', sourceSizeBytes });

		expect(db.rpc).toHaveBeenCalledWith('get_drive_pdf_reference_identity', {
			target_document_id: documentId
		});
		expect(getMetadata).toHaveBeenCalledWith(expect.objectContaining({ client: db, fileId }));
	});

	it.each([
		['version', { version: '5' }],
		['modified time', { modifiedTime: '2026-08-07T18:31:00.000Z' }],
		['checksum', { md5Checksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
		['parent folder', { parents: ['0AAnotherFolderId_123456789'] }],
		['mime type', { mimeType: 'image/png' }]
	])('rejects a staged copy whose %s changed', async (_label, patch) => {
		const getMetadata = vi.fn().mockResolvedValue({ ...liveMetadata(), ...patch });

		await expect(
			verifyDrivePdfReferenceIdentity({
				client: client(),
				documentId,
				driveFileId: fileId,
				sourceSizeBytes,
				dependencies: { getMetadata }
			})
		).rejects.toBeInstanceOf(DrivePdfReferenceChangedError);
	});

	it('rejects a stale local reference before requesting Drive metadata', async () => {
		const getMetadata = vi.fn();
		await expect(
			verifyDrivePdfReferenceIdentity({
				client: client(),
				documentId,
				driveFileId: '2AbCdEfGhIjKlMnOpQrStUvWxYz_654321',
				sourceSizeBytes,
				dependencies: { getMetadata }
			})
		).rejects.toBeInstanceOf(DrivePdfReferenceChangedError);
		expect(getMetadata).not.toHaveBeenCalled();
	});

	it('maps identity RPC failures without leaking provider details', async () => {
		await expect(
			verifyDrivePdfReferenceIdentity({
				client: client(null, new Error('postgres detail')),
				documentId,
				driveFileId: fileId,
				sourceSizeBytes,
				dependencies: { getMetadata: vi.fn() }
			})
		).rejects.toThrow('Não foi possível verificar a referência preservada do PDF.');
	});
});
