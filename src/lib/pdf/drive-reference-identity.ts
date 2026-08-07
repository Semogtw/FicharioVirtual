import { getBrowserDriveFileMetadata } from '$lib/drive/browser-metadata';
import type { DriveTokenClientLike } from '$lib/drive/browser-upload';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MD5 = /^[0-9a-f]{32}$/i;

export class DrivePdfReferenceChangedError extends Error {
	constructor() {
		super(
			'A cópia preservada no Google Drive mudou desde que foi preparada. Exclua esta referência e selecione o PDF novamente.'
		);
		this.name = 'DrivePdfReferenceChangedError';
	}
}

export class DrivePdfReferenceIdentityError extends Error {
	constructor() {
		super('Não foi possível verificar a referência preservada do PDF.');
		this.name = 'DrivePdfReferenceIdentityError';
	}
}

type IdentityClient = DriveTokenClientLike & {
	rpc(
		name: 'get_drive_pdf_reference_identity',
		args: { target_document_id: string }
	): Promise<{ data: unknown; error: unknown }>;
};

type ExpectedIdentity = Readonly<{
	documentId: string;
	driveFileId: string;
	driveParentFolderId: string;
	driveMimeType: 'application/pdf';
	driveModifiedTime: string;
	driveVersion: string;
	driveMd5Checksum: string | null;
	sourceSizeBytes: number;
}>;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function normalizeTimestamp(value: unknown) {
	if (typeof value !== 'string' || value.length < 20 || value.length > 40) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseExpectedIdentity(value: unknown): ExpectedIdentity {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new DrivePdfReferenceIdentityError();
	}
	const record = value as Record<string, unknown>;
	const modifiedTime = normalizeTimestamp(record.driveModifiedTime);
	if (
		!exactKeys(record, [
			'documentId',
			'driveFileId',
			'driveParentFolderId',
			'driveMimeType',
			'driveModifiedTime',
			'driveVersion',
			'driveMd5Checksum',
			'sourceSizeBytes'
		]) ||
		typeof record.documentId !== 'string' ||
		!UUID.test(record.documentId) ||
		typeof record.driveFileId !== 'string' ||
		!DRIVE_ID.test(record.driveFileId) ||
		typeof record.driveParentFolderId !== 'string' ||
		!DRIVE_ID.test(record.driveParentFolderId) ||
		record.driveMimeType !== 'application/pdf' ||
		modifiedTime === null ||
		typeof record.driveVersion !== 'string' ||
		!/^\d{1,32}$/.test(record.driveVersion) ||
		(record.driveMd5Checksum !== null &&
			(typeof record.driveMd5Checksum !== 'string' || !MD5.test(record.driveMd5Checksum))) ||
		typeof record.sourceSizeBytes !== 'number' ||
		!Number.isSafeInteger(record.sourceSizeBytes) ||
		record.sourceSizeBytes < 1
	) {
		throw new DrivePdfReferenceIdentityError();
	}
	return Object.freeze({
		documentId: record.documentId,
		driveFileId: record.driveFileId,
		driveParentFolderId: record.driveParentFolderId,
		driveMimeType: 'application/pdf',
		driveModifiedTime: modifiedTime,
		driveVersion: record.driveVersion,
		driveMd5Checksum:
			typeof record.driveMd5Checksum === 'string' ? record.driveMd5Checksum.toLowerCase() : null,
		sourceSizeBytes: record.sourceSizeBytes
	});
}

function samePhysicalIdentity(
	expected: ExpectedIdentity,
	live: Awaited<ReturnType<typeof getBrowserDriveFileMetadata>>
) {
	return (
		live.id === expected.driveFileId &&
		live.mimeType === expected.driveMimeType &&
		live.trashed === false &&
		live.parents.length === 1 &&
		live.parents[0] === expected.driveParentFolderId &&
		live.modifiedTime === expected.driveModifiedTime &&
		live.version === expected.driveVersion &&
		(expected.driveMd5Checksum === null ||
			live.md5Checksum?.toLowerCase() === expected.driveMd5Checksum)
	);
}

export async function verifyDrivePdfReferenceIdentity({
	client,
	documentId,
	driveFileId,
	sourceSizeBytes,
	dependencies = { getMetadata: getBrowserDriveFileMetadata }
}: {
	client: IdentityClient;
	documentId: string;
	driveFileId: string;
	sourceSizeBytes: number;
	dependencies?: {
		getMetadata: typeof getBrowserDriveFileMetadata;
	};
}): Promise<Readonly<{ driveVersion: string; sourceSizeBytes: number }>> {
	if (
		!UUID.test(documentId) ||
		!DRIVE_ID.test(driveFileId) ||
		!Number.isSafeInteger(sourceSizeBytes) ||
		sourceSizeBytes < 1
	) {
		throw new TypeError('Invalid staged Drive PDF identity');
	}

	let expected: ExpectedIdentity;
	try {
		const { data, error } = await client.rpc('get_drive_pdf_reference_identity', {
			target_document_id: documentId
		});
		if (error) throw error;
		expected = parseExpectedIdentity(data);
	} catch (error) {
		if (error instanceof DrivePdfReferenceIdentityError) throw error;
		throw new DrivePdfReferenceIdentityError();
	}

	if (
		expected.documentId !== documentId ||
		expected.driveFileId !== driveFileId ||
		expected.sourceSizeBytes !== sourceSizeBytes
	) {
		throw new DrivePdfReferenceChangedError();
	}

	const live = await dependencies.getMetadata({ client, fileId: driveFileId });
	if (!samePhysicalIdentity(expected, live)) throw new DrivePdfReferenceChangedError();

	return Object.freeze({
		driveVersion: expected.driveVersion,
		sourceSizeBytes: expected.sourceSizeBytes
	});
}
