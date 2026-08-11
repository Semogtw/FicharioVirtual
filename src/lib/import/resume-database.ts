const DATABASE_NAME = 'fichario-resume';
const DATABASE_VERSION = 2;
const STORE_NAMES = ['image-imports', 'pdf-imports'] as const;
const STORED_FILE_CODEC = 'fichario-resume-file-v1';

export type ResumeStoreName = (typeof STORE_NAMES)[number];

export interface ResumeObjectStore<T> {
	put(value: T): Promise<void>;
	list(userId?: string): Promise<readonly unknown[]>;
	delete(id: string): Promise<void>;
}

type PersistedFile = Readonly<{
	__ficharioResumeFile: typeof STORED_FILE_CODEC;
	name: string;
	type: string;
	lastModified: number;
	bytes: ArrayBuffer;
}>;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction failed'));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePersistedFile(value: unknown): PersistedFile | null {
	if (!isRecord(value) || value.__ficharioResumeFile !== STORED_FILE_CODEC) return null;
	const { name, type, lastModified, bytes } = value;
	if (
		typeof name !== 'string' ||
		typeof type !== 'string' ||
		typeof lastModified !== 'number' ||
		!Number.isInteger(lastModified) ||
		lastModified < 0 ||
		!(bytes instanceof ArrayBuffer)
	) {
		return null;
	}
	return { __ficharioResumeFile: STORED_FILE_CODEC, name, type, lastModified, bytes };
}

async function encodePersistedFile<T>(value: T): Promise<T> {
	if (typeof File === 'undefined' || !isRecord(value)) return value;
	const file = value.file;
	if (!(file instanceof File)) return value;
	const persistedFile: PersistedFile = {
		__ficharioResumeFile: STORED_FILE_CODEC,
		name: file.name,
		type: file.type,
		lastModified: file.lastModified,
		bytes: await file.arrayBuffer()
	};
	return { ...value, file: persistedFile } as T;
}

function decodePersistedFile<T>(value: T): T {
	if (typeof File === 'undefined' || !isRecord(value)) return value;
	if (value.file instanceof File) return value;
	const persistedFile = parsePersistedFile(value.file);
	if (!persistedFile) return value;
	return {
		...value,
		file: new File([persistedFile.bytes], persistedFile.name, {
			type: persistedFile.type,
			lastModified: persistedFile.lastModified
		})
	} as T;
}

let database: Promise<IDBDatabase> | null = null;

function openResumeDatabase() {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is unavailable'));
	}
	database ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			for (const storeName of STORE_NAMES) {
				if (database.objectStoreNames.contains(storeName)) continue;
				const store = database.createObjectStore(storeName, { keyPath: 'id' });
				store.createIndex('userId', 'userId', { unique: false });
				store.createIndex('updatedAt', 'updatedAt', { unique: false });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
		request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
	});
	return database;
}

class BrowserResumeObjectStore<T> implements ResumeObjectStore<T> {
	constructor(private readonly storeName: ResumeStoreName) {}

	async put(value: T) {
		// WebKit/iOS does not reliably structured-clone File into IndexedDB. Store
		// its bytes + metadata instead and rebuild File at the storage boundary.
		const persistedValue = await encodePersistedFile(value);
		const database = await openResumeDatabase();
		const transaction = database.transaction(this.storeName, 'readwrite');
		transaction.objectStore(this.storeName).put(persistedValue);
		await transactionDone(transaction);
	}

	async list(userId?: string) {
		const database = await openResumeDatabase();
		const transaction = database.transaction(this.storeName, 'readonly');
		const store = transaction.objectStore(this.storeName);
		const result = await requestResult(
			userId === undefined ? store.getAll() : store.index('userId').getAll(userId)
		);
		await transactionDone(transaction);
		return result.map((value) => decodePersistedFile(value));
	}

	async delete(id: string) {
		const database = await openResumeDatabase();
		const transaction = database.transaction(this.storeName, 'readwrite');
		transaction.objectStore(this.storeName).delete(id);
		await transactionDone(transaction);
	}
}

export function createResumeStore<T>(storeName: ResumeStoreName): ResumeObjectStore<T> {
	return new BrowserResumeObjectStore<T>(storeName);
}
