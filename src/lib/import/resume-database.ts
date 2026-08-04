const DATABASE_NAME = 'fichario-resume';
const DATABASE_VERSION = 2;
const STORE_NAMES = ['image-imports', 'pdf-imports'] as const;

export type ResumeStoreName = (typeof STORE_NAMES)[number];

export interface ResumeObjectStore<T> {
	put(value: T): Promise<void>;
	list(): Promise<readonly unknown[]>;
	delete(id: string): Promise<void>;
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
		transaction.onerror = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction failed'));
		transaction.onabort = () =>
			reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
	});
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
		const database = await openResumeDatabase();
		const transaction = database.transaction(this.storeName, 'readwrite');
		transaction.objectStore(this.storeName).put(value);
		await transactionDone(transaction);
	}

	async list() {
		const database = await openResumeDatabase();
		const transaction = database.transaction(this.storeName, 'readonly');
		const result = await requestResult(transaction.objectStore(this.storeName).getAll());
		await transactionDone(transaction);
		return result;
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
