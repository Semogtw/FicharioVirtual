import { createResumeStore, type ResumeObjectStore } from '$lib/import/resume-database';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_ID = /^[A-Za-z0-9_-]{1,160}$/;

export type StoredPdfImportStatus =
	| 'queued'
	| 'inspecting'
	| 'uploading'
	| 'rendering'
	| 'publishing'
	| 'reading'
	| 'waiting'
	| 'failed'
	| 'cancelled';

export type StoredPdfImportRecord = Readonly<{
	version: 1;
	id: string;
	userId: string;
	sessionId: string | null;
	resumeKey: string;
	file: File;
	notebookId: string | null;
	consentGranted: boolean;
	status: StoredPdfImportStatus;
	inspected: boolean;
	uploaded: boolean;
	published: boolean;
	error: string | null;
	updatedAt: string;
}>;

export type PdfResumeStore = ResumeObjectStore<StoredPdfImportRecord>;

function invalidRecord(): never {
	throw new TypeError('Invalid stored PDF import');
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function validLocalText(value: string, minimum: number, maximum: number) {
	if (value.length < minimum || value.length > maximum) return false;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return false;
	}
	return true;
}

export function parseStoredPdfImport(data: unknown): StoredPdfImportRecord {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) invalidRecord();
	const value = data as Record<string, unknown>;
	if (
		!hasExactKeys(value, [
			'version',
			'id',
			'userId',
			'sessionId',
			'resumeKey',
			'file',
			'notebookId',
			'consentGranted',
			'status',
			'inspected',
			'uploaded',
			'published',
			'error',
			'updatedAt'
		])
	) {
		invalidRecord();
	}
	const {
		version,
		id,
		userId,
		sessionId,
		resumeKey,
		file,
		notebookId,
		consentGranted,
		status,
		inspected,
		uploaded,
		published,
		error,
		updatedAt
	} = value;
	if (
		version !== 1 ||
		typeof id !== 'string' ||
		!LOCAL_ID.test(id) ||
		typeof userId !== 'string' ||
		!UUID.test(userId) ||
		(sessionId !== null && (typeof sessionId !== 'string' || !UUID.test(sessionId))) ||
		typeof resumeKey !== 'string' ||
		!validLocalText(resumeKey, 16, 160) ||
		!(file instanceof File) ||
		file.type !== 'application/pdf' ||
		file.size < 1 ||
		(notebookId !== null && (typeof notebookId !== 'string' || !UUID.test(notebookId))) ||
		typeof consentGranted !== 'boolean' ||
		typeof status !== 'string' ||
		![
			'queued',
			'inspecting',
			'uploading',
			'rendering',
			'publishing',
			'reading',
			'waiting',
			'failed',
			'cancelled'
		].includes(status) ||
		typeof inspected !== 'boolean' ||
		typeof uploaded !== 'boolean' ||
		typeof published !== 'boolean' ||
		(uploaded && !inspected) ||
		(published && !uploaded) ||
		(error !== null && (typeof error !== 'string' || !validLocalText(error, 1, 500))) ||
		typeof updatedAt !== 'string' ||
		!isIsoTimestamp(updatedAt)
	) {
		invalidRecord();
	}
	return Object.freeze({
		version: 1,
		id,
		userId,
		sessionId,
		resumeKey,
		file,
		notebookId,
		consentGranted,
		status: status as StoredPdfImportStatus,
		inspected,
		uploaded,
		published,
		error,
		updatedAt
	});
}

let browserStore: PdfResumeStore | null = null;

function defaultStore() {
	browserStore ??= createResumeStore<StoredPdfImportRecord>('pdf-imports');
	return browserStore;
}

function validOwnerId(userId: string) {
	if (!UUID.test(userId)) throw new TypeError('Invalid user identifier');
	return userId;
}

function validRecordId(id: string) {
	if (!LOCAL_ID.test(id)) throw new TypeError('Invalid stored import identifier');
	return id;
}

export async function saveStoredPdfImport(
	record: StoredPdfImportRecord,
	store: PdfResumeStore = defaultStore()
) {
	await store.put(parseStoredPdfImport(record));
}

export async function listStoredPdfImports(
	userId: string,
	store: PdfResumeStore = defaultStore()
): Promise<readonly StoredPdfImportRecord[]> {
	const ownerId = validOwnerId(userId);
	const records = (await store.list())
		.map(parseStoredPdfImport)
		.filter((record) => record.userId === ownerId)
		.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
	return Object.freeze(records);
}

export async function deleteStoredPdfImport(id: string, store: PdfResumeStore = defaultStore()) {
	await store.delete(validRecordId(id));
}
