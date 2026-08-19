const CACHE_DIRECTORY = 'fichario-media-previews-v1';
const INDEX_STORAGE_KEY = 'fichario.media-previews.v1.index';
const MEBIBYTE = 1024 * 1024;
const DEFAULT_CACHE_BUDGET_BYTES = 256 * MEBIBYTE;
const MIN_CACHE_BUDGET_BYTES = 64 * MEBIBYTE;
const MAX_CACHE_BUDGET_BYTES = 512 * MEBIBYTE;
const MAX_SINGLE_PREVIEW_BYTES = 16 * MEBIBYTE;

export type MediaPreviewCacheKey = Readonly<{
	ownerId: string;
	documentId: string;
	pageId: string;
	sourceId: string;
	kind: 'image' | 'pdf-page';
}>;

type MediaPreviewCacheEntry = Readonly<{
	key: string;
	filename: string;
	bytes: number;
	contentType: string;
	createdAt: number;
	lastAccess: number;
	ownerId: string;
}>;

type MediaPreviewCacheIndex = Record<string, MediaPreviewCacheEntry>;

type StorageManagerWithDirectory = StorageManager & {
	getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

let persistenceRequested = false;

function browserStorageManager(): StorageManagerWithDirectory | null {
	if (typeof navigator === 'undefined' || !navigator.storage) return null;
	return navigator.storage as StorageManagerWithDirectory;
}

function validKeyPart(value: string, maximumLength: number) {
	return value.length > 0 && value.length <= maximumLength && !/[\u0000-\u001f]/.test(value);
}

function serializeKey(key: MediaPreviewCacheKey) {
	if (
		!validKeyPart(key.ownerId, 128) ||
		!validKeyPart(key.documentId, 128) ||
		!validKeyPart(key.pageId, 128) ||
		!validKeyPart(key.sourceId, 768)
	) {
		throw new TypeError('Invalid local media cache key');
	}
	return JSON.stringify([key.ownerId, key.documentId, key.pageId, key.sourceId, key.kind]);
}

function fallbackHash(value: string) {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193) >>> 0;
		second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
	}
	return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

async function filenameForSerializedKey(serialized: string) {
	try {
		if (globalThis.crypto?.subtle) {
			const digest = await globalThis.crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(serialized)
			);
			const hex = Array.from(new Uint8Array(digest), (byte) =>
				byte.toString(16).padStart(2, '0')
			).join('');
			return `${hex}.preview`;
		}
	} catch {
		// The deterministic fallback still keeps cache names opaque when WebCrypto is unavailable.
	}
	return `${fallbackHash(serialized)}.preview`;
}

function readIndex(): MediaPreviewCacheIndex {
	if (typeof localStorage === 'undefined') return {};
	try {
		const raw = localStorage.getItem(INDEX_STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed as MediaPreviewCacheIndex;
	} catch {
		return {};
	}
}

function writeIndex(index: MediaPreviewCacheIndex) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(INDEX_STORAGE_KEY, JSON.stringify(index));
	} catch {
		// Cache metadata is best-effort; media remains safe to recreate from the remote original.
	}
}

async function cacheDirectory(create: boolean) {
	const storage = browserStorageManager();
	if (!storage?.getDirectory) return null;
	try {
		const root = await storage.getDirectory();
		return await root.getDirectoryHandle(CACHE_DIRECTORY, { create });
	} catch {
		return null;
	}
}

async function requestPersistentStorage() {
	if (persistenceRequested) return;
	persistenceRequested = true;
	try {
		await browserStorageManager()?.persist?.();
	} catch {
		// Persistence may be denied; the cache still works as evictable best-effort storage.
	}
}

export function localMediaCacheBudgetBytes(quota?: number) {
	if (!Number.isFinite(quota) || !quota || quota <= 0) return DEFAULT_CACHE_BUDGET_BYTES;
	return Math.min(
		MAX_CACHE_BUDGET_BYTES,
		Math.max(MIN_CACHE_BUDGET_BYTES, Math.floor(quota * 0.08))
	);
}

async function removeEntry(
	directory: FileSystemDirectoryHandle,
	index: MediaPreviewCacheIndex,
	filename: string
) {
	try {
		await directory.removeEntry(filename);
	} catch {
		// Missing files are equivalent to a successful cache eviction.
	}
	delete index[filename];
}

export async function pruneLocalMediaPreviewCache(protectedFilename?: string) {
	const directory = await cacheDirectory(false);
	if (!directory) return;
	const index = readIndex();
	const entries = Object.values(index).filter(
		(entry) =>
			entry &&
			typeof entry.filename === 'string' &&
			Number.isFinite(entry.bytes) &&
			entry.bytes > 0 &&
			Number.isFinite(entry.lastAccess)
	);
	if (entries.length === 0) return;

	let quota: number | undefined;
	let usage: number | undefined;
	try {
		const estimate = await browserStorageManager()?.estimate?.();
		quota = estimate?.quota;
		usage = estimate?.usage;
	} catch {
		// The private cache size still provides a deterministic fallback budget.
	}

	const budget = localMediaCacheBudgetBytes(quota);
	const ownBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
	const minimumFreeBytes = quota
		? Math.min(256 * MEBIBYTE, Math.max(64 * MEBIBYTE, Math.floor(quota * 0.03)))
		: 64 * MEBIBYTE;
	const freeBytes = quota !== undefined && usage !== undefined ? Math.max(0, quota - usage) : null;
	const bytesToFree = Math.max(
		0,
		ownBytes - budget,
		freeBytes === null ? 0 : minimumFreeBytes - freeBytes
	);
	if (bytesToFree <= 0) return;

	let freed = 0;
	for (const entry of [...entries].sort((left, right) => left.lastAccess - right.lastAccess)) {
		if (entry.filename === protectedFilename) continue;
		await removeEntry(directory, index, entry.filename);
		freed += entry.bytes;
		if (freed >= bytesToFree) break;
	}
	writeIndex(index);
}

export async function readLocalMediaPreview(key: MediaPreviewCacheKey): Promise<Blob | null> {
	let serialized: string;
	try {
		serialized = serializeKey(key);
	} catch {
		return null;
	}
	const directory = await cacheDirectory(false);
	if (!directory) return null;
	const filename = await filenameForSerializedKey(serialized);
	try {
		const index = readIndex();
		const previous = index[filename];
		if (
			!previous ||
			previous.key !== serialized ||
			!previous.contentType.startsWith('image/') ||
			!Number.isFinite(previous.bytes) ||
			previous.bytes < 1 ||
			previous.bytes > MAX_SINGLE_PREVIEW_BYTES
		) {
			return null;
		}
		const handle = await directory.getFileHandle(filename);
		const file = await handle.getFile();
		if (file.size !== previous.bytes || file.size < 1 || file.size > MAX_SINGLE_PREVIEW_BYTES) {
			await removeEntry(directory, index, filename);
			writeIndex(index);
			return null;
		}
		const blob =
			file.type.startsWith('image/') && file.type === previous.contentType
				? file
				: file.slice(0, file.size, previous.contentType);
		index[filename] = Object.freeze({
			...previous,
			lastAccess: Date.now(),
			ownerId: key.ownerId
		});
		writeIndex(index);
		return blob;
	} catch {
		return null;
	}
}

export async function writeLocalMediaPreview(
	key: MediaPreviewCacheKey,
	blob: Blob
): Promise<boolean> {
	if (blob.size < 1 || blob.size > MAX_SINGLE_PREVIEW_BYTES || !blob.type.startsWith('image/')) {
		return false;
	}
	let serialized: string;
	try {
		serialized = serializeKey(key);
	} catch {
		return false;
	}
	const directory = await cacheDirectory(true);
	if (!directory) return false;
	await requestPersistentStorage();
	const filename = await filenameForSerializedKey(serialized);
	try {
		const handle = await directory.getFileHandle(filename, { create: true });
		const writable = await handle.createWritable();
		try {
			await writable.write(blob);
			await writable.close();
		} catch (error) {
			try {
				await writable.abort();
			} catch {
				// Ignore secondary cleanup failures.
			}
			throw error;
		}
		const now = Date.now();
		const index = readIndex();
		const previous = index[filename];
		index[filename] = Object.freeze({
			key: serialized,
			filename,
			bytes: blob.size,
			contentType: blob.type,
			createdAt: previous?.createdAt ?? now,
			lastAccess: now,
			ownerId: key.ownerId
		});
		writeIndex(index);
		void pruneLocalMediaPreviewCache(filename);
		return true;
	} catch {
		return false;
	}
}

export async function clearLocalMediaPreviewCacheForOwner(ownerId: string) {
	if (!validKeyPart(ownerId, 128)) return;
	const directory = await cacheDirectory(false);
	if (!directory) return;
	const index = readIndex();
	for (const entry of Object.values(index)) {
		if (entry?.ownerId === ownerId) await removeEntry(directory, index, entry.filename);
	}
	writeIndex(index);
}
