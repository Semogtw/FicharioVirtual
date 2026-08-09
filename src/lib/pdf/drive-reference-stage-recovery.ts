const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MD5 = /^[0-9a-f]{32}$/i;
const KNOWN_MISSING_STAGE_SQLSTATE = '55000';

export type DrivePdfReferenceStageIdentity = Readonly<{
	documentId: string;
	driveFileId: string;
	driveParentFolderId: string;
	driveMimeType: 'application/pdf';
	driveModifiedTime: string;
	driveVersion: string;
	driveMd5Checksum: string | null;
	sourceSizeBytes: number;
}>;

export type RecoveredDrivePdfReferenceStage = Readonly<{
	documentId: string;
	driveFileId: string;
	sourceSizeBytes: number;
	status: 'pending_inspection';
}>;

type StageRecoveryClient = Readonly<{
	rpc(
		name: 'get_drive_pdf_reference_identity',
		args: { target_document_id: string }
	): Promise<{ data: unknown; error: unknown }>;
	from(table: 'documents'): {
		select(columns: 'id'): {
			eq(
				column: 'id',
				value: string
			): {
				maybeSingle(): Promise<{ data: unknown; error: unknown }>;
			};
		};
	};
}>;

export class DrivePdfReferenceStageRecoveryError extends Error {
	constructor() {
		super(
			'Não foi possível confirmar se o PDF já foi registrado. A cópia no Google Drive foi preservada.'
		);
		this.name = 'DrivePdfReferenceStageRecoveryError';
	}
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function normalizeTimestamp(value: unknown) {
	if (typeof value !== 'string' || value.length < 20 || value.length > 40) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function validIdentity(value: DrivePdfReferenceStageIdentity) {
	return (
		UUID.test(value.documentId) &&
		DRIVE_ID.test(value.driveFileId) &&
		DRIVE_ID.test(value.driveParentFolderId) &&
		value.driveMimeType === 'application/pdf' &&
		normalizeTimestamp(value.driveModifiedTime) === value.driveModifiedTime &&
		/^\d{1,32}$/.test(value.driveVersion) &&
		(value.driveMd5Checksum === null || MD5.test(value.driveMd5Checksum)) &&
		Number.isSafeInteger(value.sourceSizeBytes) &&
		value.sourceSizeBytes > 0
	);
}

function parseIdentity(value: unknown): DrivePdfReferenceStageIdentity {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new DrivePdfReferenceStageRecoveryError();
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
		throw new DrivePdfReferenceStageRecoveryError();
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

function errorCode(error: unknown) {
	if (error === null || typeof error !== 'object' || Array.isArray(error)) return null;
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' ? code : null;
}

function sameIdentity(
	expected: DrivePdfReferenceStageIdentity,
	actual: DrivePdfReferenceStageIdentity
) {
	const expectedMd5 = expected.driveMd5Checksum?.toLowerCase() ?? null;
	return (
		actual.documentId === expected.documentId &&
		actual.driveFileId === expected.driveFileId &&
		actual.driveParentFolderId === expected.driveParentFolderId &&
		actual.driveMimeType === expected.driveMimeType &&
		actual.driveModifiedTime === expected.driveModifiedTime &&
		actual.driveVersion === expected.driveVersion &&
		actual.driveMd5Checksum === expectedMd5 &&
		actual.sourceSizeBytes === expected.sourceSizeBytes
	);
}

async function documentAbsenceIsConfirmed(client: StageRecoveryClient, documentId: string) {
	try {
		const { data, error } = await client
			.from('documents')
			.select('id')
			.eq('id', documentId)
			.maybeSingle();
		if (error) throw error;
		if (data === null) return true;
		if (
			typeof data !== 'object' ||
			Array.isArray(data) ||
			!exactKeys(data as Record<string, unknown>, ['id']) ||
			(data as { id?: unknown }).id !== documentId
		) {
			throw new Error('invalid document recovery response');
		}
		return false;
	} catch {
		throw new DrivePdfReferenceStageRecoveryError();
	}
}

export async function recoverDrivePdfReferenceStage({
	client,
	expected
}: {
	client: StageRecoveryClient;
	expected: DrivePdfReferenceStageIdentity;
}): Promise<RecoveredDrivePdfReferenceStage | null> {
	if (!validIdentity(expected)) throw new TypeError('Invalid expected Drive PDF staging identity');

	let data: unknown;
	try {
		const result = await client.rpc('get_drive_pdf_reference_identity', {
			target_document_id: expected.documentId
		});
		if (result.error) {
			if (errorCode(result.error) === KNOWN_MISSING_STAGE_SQLSTATE) {
				return (await documentAbsenceIsConfirmed(client, expected.documentId))
					? null
					: Promise.reject(new DrivePdfReferenceStageRecoveryError());
			}
			throw result.error;
		}
		data = result.data;
	} catch (error) {
		if (error instanceof DrivePdfReferenceStageRecoveryError) throw error;
		throw new DrivePdfReferenceStageRecoveryError();
	}

	const actual = parseIdentity(data);
	if (!sameIdentity(expected, actual)) throw new DrivePdfReferenceStageRecoveryError();
	return Object.freeze({
		documentId: expected.documentId,
		driveFileId: expected.driveFileId,
		sourceSizeBytes: expected.sourceSizeBytes,
		status: 'pending_inspection'
	});
}
