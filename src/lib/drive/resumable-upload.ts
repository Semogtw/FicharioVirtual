import { parseDriveFile } from './contracts';
import type { DriveFile } from './types';

export const DRIVE_UPLOAD_CHUNK_ALIGNMENT = 256 * 1024;

export interface DriveUploadResponse {
	status: number;
	range: string | null;
	body: unknown;
}

export interface DriveResumableGateway {
	uploadChunk(input: {
		sessionUrl: string;
		body: Blob;
		contentRange: string;
	}): Promise<DriveUploadResponse>;
	queryProgress(input: {
		sessionUrl: string;
		totalBytes: number;
	}): Promise<DriveUploadResponse>;
}

function safeInteger(value: number) {
	return Number.isSafeInteger(value);
}

export function validateDriveUploadSessionUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError('Invalid Drive upload session URL');
	}

	const officialHost = ['www.googleapis.com', 'upload.googleapis.com'].includes(url.hostname);
	const drivePath =
		url.pathname === '/upload/drive/v3/files' || url.pathname.startsWith('/upload/drive/v3/files/');
	if (
		url.protocol !== 'https:' ||
		!officialHost ||
		!drivePath ||
		url.username !== '' ||
		url.password !== '' ||
		url.searchParams.get('uploadType') !== 'resumable'
	) {
		throw new TypeError('Invalid Drive upload session URL');
	}
	return url.toString();
}

export function contentRangeForChunk(start: number, endExclusive: number, total: number): string {
	if (
		!safeInteger(start) ||
		!safeInteger(endExclusive) ||
		!safeInteger(total) ||
		total <= 0 ||
		start < 0 ||
		start >= endExclusive ||
		endExclusive > total
	) {
		throw new TypeError('Invalid Drive upload range');
	}
	return `bytes ${start}-${endExclusive - 1}/${total}`;
}

export function parseDriveCommittedRange(range: string | null, total: number): number {
	if (!safeInteger(total) || total <= 0) throw new TypeError('Invalid Drive committed range');
	if (range === null) return 0;
	const match = /^bytes=0-(\d+)$/.exec(range);
	if (!match) throw new TypeError('Invalid Drive committed range');
	const nextOffset = Number(match[1]) + 1;
	if (!safeInteger(nextOffset) || nextOffset <= 0 || nextOffset > total) {
		throw new TypeError('Invalid Drive committed range');
	}
	return nextOffset;
}

function validateChunkSize(value: number): number {
	if (
		!safeInteger(value) ||
		value < DRIVE_UPLOAD_CHUNK_ALIGNMENT ||
		value % DRIVE_UPLOAD_CHUNK_ALIGNMENT !== 0
	) {
		throw new TypeError('Invalid Drive upload chunk size');
	}
	return value;
}

function terminal(response: DriveUploadResponse): DriveFile | null {
	if (response.status !== 200 && response.status !== 201) return null;
	return parseDriveFile(response.body);
}

export async function uploadDriveBlob({
	blob,
	sessionUrl,
	chunkSize,
	gateway
}: {
	blob: Blob;
	sessionUrl: string;
	chunkSize: number;
	gateway: DriveResumableGateway;
}): Promise<DriveFile> {
	if (!(blob instanceof Blob) || !safeInteger(blob.size) || blob.size <= 0) {
		throw new TypeError('Invalid Drive upload body');
	}
	const safeUrl = validateDriveUploadSessionUrl(sessionUrl);
	const safeChunkSize = validateChunkSize(chunkSize);
	let offset = 0;

	while (offset < blob.size) {
		const endExclusive = Math.min(offset + safeChunkSize, blob.size);
		let response: DriveUploadResponse;
		try {
			response = await gateway.uploadChunk({
				sessionUrl: safeUrl,
				body: blob.slice(offset, endExclusive),
				contentRange: contentRangeForChunk(offset, endExclusive, blob.size)
			});
		} catch {
			response = await gateway.queryProgress({ sessionUrl: safeUrl, totalBytes: blob.size });
		}

		const completed = terminal(response);
		if (completed) return completed;
		if (response.status !== 308) throw new Error('Drive upload failed');
		const nextOffset = parseDriveCommittedRange(response.range, blob.size);
		if (nextOffset <= offset) throw new Error('Drive upload did not advance');
		offset = nextOffset;
	}

	throw new Error('Drive upload ended without a file response');
}
