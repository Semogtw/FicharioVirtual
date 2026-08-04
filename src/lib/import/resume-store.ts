import type { ImagePreparationMode } from './image-types';
import type { UploadedPage } from './upload';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const LOCAL_ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DATABASE_NAME = 'fichario-resume';
const STORE_NAME = 'image-imports';
const DATABASE_VERSION = 1;

export type StoredImageImportStatus =
	| 'queued'
	| 'preparing'
	| 'uploading'
	| 'reading'
	| 'waiting'
	| 'failed'
	| 'cancelled';

export type StoredImageImportRecord = Readonly<{
	version: 1;
	id: string;
	userId: string;
	sessionId: string | null;
	resumeKey: string;
	file: File;
	mode: ImagePreparationMode;
	notebookId: string | null;
	status: StoredImageImportStatus;
	preparedBytes: number | null;
	result: UploadedPage | null;
	error: string | null;
	updatedAt: string;
}>;

export interface ImportResumeStore {
	put(value: StoredImageImportRecord): Promise<void>;
	list(): Promise<readonly unknown[]>;
	delete(id: string): Promise<void>;
}

function invalidRecord(): never {
	throw new TypeError('Invalid stored image import');
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
	return (
		value.length >= minimum &&
		value.length <= maximum &&
		!/[\u0000-\u001f\u007f]/.test(value)
	);
}

function parseUploadedPage(data: unknown, userId: string): UploadedPage | null {
	if (data === null) return null;
	if (typeof data !== 'object' || Array.isArray(data)) invalidRecord();
	const value = data as Record<string, unknown>;
	if (
		!hasExactKeys(value, [
			'documentId',
			'pageId',
			'ocrJobId',
			'sha256',
			'storagePath',
			'thumbnailPath'
		])
	) {
		invalidRecord();
	}
	const { documentId, pageId, ocrJobId, sha256, storagePath, thumbnailPath } = value;
	if (
		typeof documentId !== 'string' ||
		!UUID.test(documentId) ||
		typeof pageId !== 'string' ||
		!UUID.test(pageId) ||
		typeof ocrJobId !== 'string' ||
		!UUID.test(ocrJobId) ||
		typeof sha256 !== 'string' ||
		!SHA256.test(sha256) ||
		typeof storagePath !== 'string' ||
		!storagePath.startsWith(`${userId}/`) ||
		!validLocalText(storagePath, 3, 1024) ||
		typeof thumbnailPath !== 'string' ||
		!thumbnailPath.startsWith(`${userId}/`) ||
		!validLocalText(thumbnailPath, 3, 1024)
	) {
		invalidRecord();
	}
	return Object.freeze({ documentId, pageId, ocrJobId, sha256, storagePath, thumbnailPath });
}

export function parseStoredImageImport(data: unknown): StoredImageImportRecord {
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
			'mode',
			'notebookId',
			'status',
			'preparedBytes',
			'result',
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
		mode,
		notebookId,
		status,
		preparedBytes,
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
		!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
		file.size < 1 ||
		file.size > MAX_IMAGE_BYTES ||
		(mode !== 'standard' && mode !== 'high-definition') ||
		(notebookId !== null && (typeof notebookId !== 'string' || !UUID.test(notebookId))) ||
		typeof status !== 'string' ||
		!['queued', 'preparing', 'uploading', 'reading', 'waiting', 'failed', 'cancelled'].includes(
			status
		) ||
		(preparedBytes !== null &&
			(typeof preparedBytes !== 'number' ||
				!Number.isInteger(preparedBytes) ||
				preparedBytes < 0 ||
				preparedBytes > MAX_IMAGE_BYTES)) ||
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
		mode,
		notebookId,
		status: status as StoredImageImportStatus,
		preparedBytes,
		result: parseUploadedPage(value.result, userId),
		error,
		updatedAt
	});
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
		transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
	});
}

class BrowserImportResumeStore implements ImportResumeStore {
	private database: Promise<IDBDatabase> | null = null;

	async put(value: StoredImageImportRecord) {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).put(value);
		await transactionDone(transaction);
	}

	async list() {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, 'readonly');
		const result = await requestResult(transaction.objectStore(STORE_NAME).getAll());
		await transactionDone(transaction);
		return result;
	}

	async delete(id: string) {
		const database = await this.open();
		const transaction = database.transaction(STORE_NAME, 'readwrite');
		transaction.objectStore(STORE_NAME).delete(id);
		await transactionDone(transaction);
	}

	private open() {
		if (typeof indexedDB === 'undefined') {
			return Promise.reject(new Error('IndexedDB is unavailable'));
		}
		this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
			request.onupgradeneeded = () => {
				const database = request.result;
				if (!database.objectStoreNames.contains(STORE_NAME)) {
					const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
					store.createIndex('userId', 'userId', { unique: false });
					store.createIndex('updatedAt', 'updatedAt', { unique: false });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
			request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
		});
		return this.database;
	}
}

let browserStore: ImportResumeStore | null = null;

function defaultStore() {
	browserStore ??= new BrowserImportResumeStore();
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

export async function saveStoredImageImport(
	record: StoredImageImportRecord,
	store: ImportResumeStore = defaultStore()
) {
	await store.put(parseStoredImageImport(record));
}

export async function listStoredImageImports(
	userId: string,
	store: ImportResumeStore = defaultStore()
): Promise<readonly StoredImageImportRecord[]> {
	const ownerId = validOwnerId(userId);
	const records = (await store.list())
		.map(parseStoredImageImport)
		.filter((record) => record.userId === ownerId)
		.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
	return Object.freeze(records);
}

export async function deleteStoredImageImport(
	id: string,
	store: ImportResumeStore = defaultStore()
) {
	await store.delete(validRecordId(id));
}
