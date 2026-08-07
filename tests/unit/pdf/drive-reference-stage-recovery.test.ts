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
	driveMimeType: 'application/pdf',
	driveModifiedTime: modifiedTime,
	driveVersion,
	driveMd5Checksum: md5Checksum,
	sourceSizeBytes
};

function client(data: unknown, error: unknown = null) {
	return {
		rpc: vi.fn().mockResolvedValue({ data, error })
	} as never;
}

describe('Drive PDF reference staging recovery', () => {
	it('recovers an exact durable stage after the RPC response was lost', async () => {
		await expect(
			recoverDrivePdfReferenceStage({
				client: client(expected),
				expected
			})
		).resolves.toEqual({
			documentId,
			driveFileId,
			sourceSizeBytes,
			status: 'pending_inspection'
		});
	});

	it('returns null only for the explicit SQL state meaning no staged identity exists', async () => {
		await expect(
			recoverDrivePdfReferenceStage({
				client: client(null, {
					code: '55000',
					message: 'Drive PDF reference identity is unavailable'
				}),
				expected
			})
		).resolves.toBeNull();
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
