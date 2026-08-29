import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
	resolveByDriveFileId: vi.fn(),
	readBlob: vi.fn(),
	readRange: vi.fn(),
	cacheRemote: vi.fn()
}));

vi.mock('$lib/native/local-document-store', () => ({
	resolveNativeDocumentByDriveFileId: native.resolveByDriveFileId,
	readNativeDocumentBlob: native.readBlob,
	readNativeDocumentRange: native.readRange,
	cacheRemoteFileInNativeStore: native.cacheRemote
}));

vi.mock('$lib/stores/session.svelte', () => ({
	sessionState: { user: null }
}));

import {
	downloadBrowserDriveFile,
	downloadBrowserDriveRange,
	type DriveMediaClientLike
} from '../../../src/lib/drive/browser-download';

const FILE_ID = 'drive_file_1234567890';
const DOCUMENT_ID = '550e8400-e29b-41d4-a716-446655440000';

const localDocument = Object.freeze({
	documentId: DOCUMENT_ID,
	ownerId: '550e8400-e29b-41d4-a716-446655440001',
	originalFilename: 'arquivo.pdf',
	mimeType: 'application/pdf',
	sizeBytes: 12,
	sha256: 'a'.repeat(64),
	localState: 'present' as const,
	remoteState: 'synced' as const,
	remoteDocumentId: DOCUMENT_ID,
	driveFileId: FILE_ID,
	createdAtMs: 1,
	updatedAtMs: 2,
	lastAccessedAtMs: 3
});

function client() {
	return {
		functions: {
			invoke: vi.fn()
		}
	} as unknown as DriveMediaClientLike;
}

beforeEach(() => {
	vi.clearAllMocks();
	native.resolveByDriveFileId.mockResolvedValue(localDocument);
});

describe('native Drive fast path', () => {
	it('opens a complete local original without invoking drive-media', async () => {
		const media = new Blob([new Uint8Array(12)], { type: 'application/pdf' });
		native.readBlob.mockResolvedValue(media);
		const drive = client();

		const result = await downloadBrowserDriveFile({
			client: drive,
			fileId: FILE_ID,
			maximumBytes: 1024
		});

		expect(result).toBe(media);
		expect(native.resolveByDriveFileId).toHaveBeenCalledWith(FILE_ID);
		expect(native.readBlob).toHaveBeenCalledWith(localDocument);
		expect(drive.functions.invoke).not.toHaveBeenCalled();
	});

	it('serves PDF ranges locally without invoking drive-media', async () => {
		const rangeBytes = Uint8Array.from([4, 5, 6, 7]);
		native.readRange.mockResolvedValue(rangeBytes);
		const drive = client();

		const result = await downloadBrowserDriveRange({
			client: drive,
			fileId: FILE_ID,
			start: 4,
			endExclusive: 8,
			totalBytes: 12
		});

		expect(new Uint8Array(await result.arrayBuffer())).toEqual(rangeBytes);
		expect(native.readRange).toHaveBeenCalledWith(DOCUMENT_ID, 4, 8);
		expect(drive.functions.invoke).not.toHaveBeenCalled();
	});

	it('falls back to Drive when the native original is absent', async () => {
		native.resolveByDriveFileId.mockResolvedValue(null);
		const drive = client();
		const remote = new Blob([new Uint8Array(12)], { type: 'application/pdf' });
		vi.mocked(drive.functions.invoke).mockResolvedValue({
			data: remote,
			error: null,
			response: new Response(null, { headers: { 'X-Drive-Media-Type': 'application/pdf' } })
		});

		const result = await downloadBrowserDriveFile({
			client: drive,
			fileId: FILE_ID,
			maximumBytes: 1024
		});

		expect(result.type).toBe('application/pdf');
		expect(drive.functions.invoke).toHaveBeenCalledTimes(1);
	});
});
