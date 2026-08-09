import { describe, expect, it, vi } from 'vitest';
import {
	DrivePdfReferenceStageRecoveryError,
	recoverDrivePdfReferenceStage
} from '../../../src/lib/pdf/drive-reference-stage-recovery';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const driveFileId = '2AbCdEfGhIjKlMnOpQrStUvWxYz_123456';
const parentFolderId = '0ALargePdfFolderId_123456789';
const modifiedTime = '2026-08-07T10:00:00.000Z';
const driveVersion = '2';
const md5Checksum = 'd41d8cd98f00b204e9800998ecf8427e';
const sourceSizeBytes = 120 * 1024 * 1024;

const expected = {
	documentId,
	driveFileId,
	driveParentFolderId: parentFolderId,
	driveMimeType: 'application/pdf' as const,
	driveModifiedTime: modifiedTime,
	driveVersion,
	driveMd5Checksum: md5Checksum,
	sourceSizeBytes
};

function client(
	data: unknown,
	error: unknown = null,
	documentLookup: { data: unknown; error: unknown } = { data: null, error: null }
) {
	return {
		rpc: vi.fn().mockResolvedValue({ data, error }),
		from: vi.fn(() => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({
					maybeSingle: vi.fn().mockResolvedValue(documentLookup)
				}))
			}))
		}))
	};
}

describe('Drive PDF reference staging recovery', () => {
	it('recovers an exact durable stage after the RPC response was lost', async () => {
		const current = client(expected);
		await expect(
			recoverDrivePdfReferenceStage({
				client: current,
				expected
			})
		).resolves.toEqual({
			documentId,
			driveFileId,
			sourceSizeBytes,
			status: 'pending_inspection'
		});
		expect(current.from).not.toHaveBeenCalled();
	});

	it('also recovers an exact identity when Drive does not expose an MD5 checksum', async () => {
		const withoutMd5 = { ...expected, driveMd5Checksum: null };
		await expect(
			recoverDrivePdfReferenceStage({
				client: client(withoutMd5),
				expected: withoutMd5
			})
		).resolves.toMatchObject({ documentId, driveFileId, sourceSizeBytes });
	});

	it('returns null only when SQL reports no staged identity and the document row is also absent', async () => {
		const current = client(null, {
			code: '55000',
			message: 'Drive PDF reference identity is unavailable'
		});
		await expect(recoverDrivePdfReferenceStage({ client: current, expected })).resolves.toBeNull();
		expect(current.from).toHaveBeenCalledWith('documents');
	});

	it('preserves the Drive copy if staging vanished because the document may already be finalized', async () => {
		const current = client(
			null,
			{ code: '55000', message: 'Drive PDF reference identity is unavailable' },
			{ data: { id: documentId }, error: null }
		);
		await expect(
			recoverDrivePdfReferenceStage({ client: current, expected })
		).rejects.toBeInstanceOf(DrivePdfReferenceStageRecoveryError);
	});

	it('fails closed if document absence cannot be proven after SQLSTATE 55000', async () => {
		const current = client(
			null,
			{ code: '55000', message: 'Drive PDF reference identity is unavailable' },
			{ data: null, error: new Error('database lookup unavailable') }
		);
		await expect(
			recoverDrivePdfReferenceStage({ client: current, expected })
		).rejects.toBeInstanceOf(DrivePdfReferenceStageRecoveryError);
	});

	it('fails closed for network, auth, and other unknown lookup failures', async () => {
		for (const error of [
			new Error('network unavailable'),
			{ code: '42501', message: 'Not authorized' },
			{ code: 'PGRST301', message: 'request failed' }
		]) {
			await expect(
				recoverDrivePdfReferenceStage({ client: client(null, error), expected })
			).rejects.toBeInstanceOf(DrivePdfReferenceStageRecoveryError);
		}
	});

	it('fails closed when the durable identity differs from the copied Drive file', async () => {
		for (const data of [
			{ ...expected, driveFileId: '3AbCdEfGhIjKlMnOpQrStUvWxYz_123456' },
			{ ...expected, driveParentFolderId: '0AOtherFolderId_123456789' },
			{ ...expected, driveVersion: '3' },
			{ ...expected, sourceSizeBytes: sourceSizeBytes + 1 },
			{ ...expected, driveMd5Checksum: '00000000000000000000000000000000' }
		]) {
			await expect(
				recoverDrivePdfReferenceStage({ client: client(data), expected })
			).rejects.toBeInstanceOf(DrivePdfReferenceStageRecoveryError);
		}
	});

	it('rejects malformed identity payloads instead of treating them as absence', async () => {
		for (const data of [null, {}, { ...expected, accessToken: 'must-not-be-here' }]) {
			await expect(
				recoverDrivePdfReferenceStage({ client: client(data), expected })
			).rejects.toBeInstanceOf(DrivePdfReferenceStageRecoveryError);
		}
	});
});
