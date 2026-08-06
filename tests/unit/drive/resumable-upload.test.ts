import { describe, expect, it, vi } from 'vitest';
import {
	DRIVE_UPLOAD_CHUNK_ALIGNMENT,
	contentRangeForChunk,
	parseDriveCommittedRange,
	uploadDriveBlob,
	validateDriveUploadSessionUrl,
	type DriveResumableGateway
} from '../../../src/lib/drive/resumable-upload';

const sessionUrl =
	'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=secure-session';
const folderId = '0AExampleRootFolderId_123456789';
const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function driveFile() {
	return {
		id: fileId,
		name: 'Caderno.pdf',
		mimeType: 'application/pdf',
		parents: [folderId],
		modifiedTime: '2026-08-06T05:00:00.000Z',
		version: '1',
		md5Checksum: 'd41d8cd98f00b204e9800998ecf8427e',
		trashed: false
	};
}

describe('Drive resumable upload primitives', () => {
	it('uses the Google chunk alignment and builds exact Content-Range values', () => {
		expect(DRIVE_UPLOAD_CHUNK_ALIGNMENT).toBe(256 * 1024);
		expect(contentRangeForChunk(0, 256 * 1024, 600 * 1024)).toBe(
			'bytes 0-262143/614400'
		);
		expect(contentRangeForChunk(512 * 1024, 600 * 1024, 600 * 1024)).toBe(
			'bytes 524288-614399/614400'
		);
		expect(() => contentRangeForChunk(10, 10, 100)).toThrow('Invalid Drive upload range');
	});

	it('parses committed ranges and rejects inconsistent progress', () => {
		expect(parseDriveCommittedRange(null, 600 * 1024)).toBe(0);
		expect(parseDriveCommittedRange('bytes=0-262143', 600 * 1024)).toBe(256 * 1024);
		expect(() => parseDriveCommittedRange('bytes=10-20', 600 * 1024)).toThrow(
			'Invalid Drive committed range'
		);
		expect(() => parseDriveCommittedRange('bytes=0-999999', 600 * 1024)).toThrow(
			'Invalid Drive committed range'
		);
	});

	it('accepts only official HTTPS Drive upload session URLs', () => {
		expect(validateDriveUploadSessionUrl(sessionUrl)).toBe(sessionUrl);
		expect(
			validateDriveUploadSessionUrl(
				'https://upload.googleapis.com/upload/drive/v3/files/abc?uploadType=resumable&upload_id=x'
			)
		).toContain('upload.googleapis.com');
		expect(() => validateDriveUploadSessionUrl('https://evil.example/upload/drive/v3/files')).toThrow(
			'Invalid Drive upload session URL'
		);
		expect(() =>
			validateDriveUploadSessionUrl('http://www.googleapis.com/upload/drive/v3/files')
		).toThrow('Invalid Drive upload session URL');
	});
});

describe('Drive resumable upload runner', () => {
	it('uploads aligned chunks and accepts the strict final Drive file response', async () => {
		const blob = new Blob([new Uint8Array(600 * 1024)], { type: 'application/pdf' });
		const ranges: string[] = [];
		const uploadChunk = vi
			.fn<DriveResumableGateway['uploadChunk']>()
			.mockImplementation(async ({ contentRange }) => {
				ranges.push(contentRange);
				if (ranges.length === 1) return { status: 308, range: 'bytes=0-262143', body: null };
				if (ranges.length === 2) return { status: 308, range: 'bytes=0-524287', body: null };
				return { status: 200, range: null, body: driveFile() };
			});
		const gateway: DriveResumableGateway = {
			uploadChunk,
			queryProgress: vi.fn()
		};

		const result = await uploadDriveBlob({
			blob,
			sessionUrl,
			chunkSize: 256 * 1024,
			gateway
		});

		expect(result).toEqual(driveFile());
		expect(ranges).toEqual([
			'bytes 0-262143/614400',
			'bytes 262144-524287/614400',
			'bytes 524288-614399/614400'
		]);
		expect(uploadChunk.mock.calls.map(([call]) => call.body.size)).toEqual([
			256 * 1024,
			256 * 1024,
			88 * 1024
		]);
	});

	it('queries server progress after a network failure and resumes without duplicating bytes', async () => {
		const blob = new Blob([new Uint8Array(512 * 1024)], { type: 'application/pdf' });
		const ranges: string[] = [];
		const uploadChunk = vi
			.fn<DriveResumableGateway['uploadChunk']>()
			.mockImplementationOnce(async ({ contentRange }) => {
				ranges.push(contentRange);
				throw new TypeError('network disconnected');
			})
			.mockImplementationOnce(async ({ contentRange }) => {
				ranges.push(contentRange);
				return { status: 200, range: null, body: driveFile() };
			});
		const queryProgress = vi.fn<DriveResumableGateway['queryProgress']>().mockResolvedValue({
			status: 308,
			range: 'bytes=0-262143',
			body: null
		});

		const result = await uploadDriveBlob({
			blob,
			sessionUrl,
			chunkSize: 256 * 1024,
			gateway: { uploadChunk, queryProgress }
		});

		expect(result.id).toBe(fileId);
		expect(queryProgress).toHaveBeenCalledWith({ sessionUrl, totalBytes: 512 * 1024 });
		expect(ranges).toEqual([
			'bytes 0-262143/524288',
			'bytes 262144-524287/524288'
		]);
	});

	it('rejects misaligned chunks, stalled 308 progress, and malformed final responses', async () => {
		const blob = new Blob([new Uint8Array(300 * 1024)]);
		const gateway: DriveResumableGateway = {
			uploadChunk: vi.fn().mockResolvedValue({ status: 308, range: null, body: null }),
			queryProgress: vi.fn()
		};

		await expect(
			uploadDriveBlob({ blob, sessionUrl, chunkSize: 200 * 1024, gateway })
		).rejects.toThrow('Invalid Drive upload chunk size');
		await expect(
			uploadDriveBlob({ blob, sessionUrl, chunkSize: 256 * 1024, gateway })
		).rejects.toThrow('Drive upload did not advance');

		gateway.uploadChunk = vi.fn().mockResolvedValue({
			status: 200,
			range: null,
			body: { id: fileId, accessToken: 'must-not-pass' }
		});
		await expect(
			uploadDriveBlob({ blob, sessionUrl, chunkSize: 256 * 1024, gateway })
		).rejects.toThrow('Invalid Drive file response');
	});
});
