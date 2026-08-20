import {
	cacheRemoteFileInNativeStore,
	readNativeDocumentBlob,
	readNativeDocumentRange,
	resolveNativeDocumentByDriveFileId
} from '$lib/native/local-document-store';
import { sessionState } from '$lib/stores/session.svelte';

const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;

export type DriveMediaClientLike = {
	functions: {
		invoke(
			name: 'drive-media',
			options: { body: Record<string, unknown> }
		): Promise<{ data: unknown; error: unknown; response?: Response }>;
	};
};

type DriveMediaInvocation = Readonly<{ data: unknown; response?: Response }>;

function validDriveId(value: string): string {
	if (!DRIVE_ID.test(value)) throw new TypeError('Invalid Google Drive file identifier');
	return value;
}

function validMaximumBytes(value: number) {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError('Invalid Google Drive download limit');
	}
	return value;
}

function validDriveDownloadRange(start: number, endExclusive: number, totalBytes: number) {
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		!Number.isSafeInteger(totalBytes) ||
		start < 0 ||
		endExclusive <= start ||
		endExclusive > totalBytes
	) {
		throw new TypeError('Invalid Google Drive download range');
	}
	return Object.freeze({ start, endExclusive, totalBytes });
}

async function invokeDriveMedia(
	client: DriveMediaClientLike,
	body: Record<string, unknown>
): Promise<DriveMediaInvocation> {
	const { data, error, response } = await client.functions.invoke('drive-media', { body });
	if (error) throw new Error('drive media request failed');
	return Object.freeze({ data, ...(response ? { response } : {}) });
}

async function readDriveMediaRange({
	client,
	fileId,
	start,
	endExclusive,
	totalBytes
}: {
	client: DriveMediaClientLike;
	fileId: string;
	start: number;
	endExclusive: number;
	totalBytes: number;
}): Promise<Blob> {
	const { data } = await invokeDriveMedia(client, {
		operation: 'read',
		fileId,
		start,
		endExclusive,
		totalBytes
	});
	if (!(data instanceof Blob) || data.size !== endExclusive - start) {
		throw new Error('invalid drive media response');
	}
	return data;
}

async function localDriveDocument(fileId: string) {
	try {
		return await resolveNativeDocumentByDriveFileId(fileId);
	} catch {
		return null;
	}
}

function cacheFilename(blob: Blob) {
	if (blob.type === 'application/pdf') return 'documento.pdf';
	const subtype = blob.type.startsWith('image/')
		? blob.type.slice('image/'.length).replace('jpeg', 'jpg')
		: '';
	return subtype ? `documento.${subtype}` : 'documento.bin';
}

async function syntheticDriveDocumentId(fileId: string) {
	if (!globalThis.crypto?.subtle) return null;
	const bytes = new TextEncoder().encode(fileId);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return `drive_${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function warmNativeDriveCache(fileId: string, blob: Blob) {
	const ownerId = sessionState.user?.id;
	if (!ownerId) return;
	if (blob.type !== 'application/pdf' && !blob.type.startsWith('image/')) return;
	const documentId = await syntheticDriveDocumentId(fileId);
	if (!documentId) return;
	const file = new File([blob], cacheFilename(blob), {
		type: blob.type,
		lastModified: Date.now()
	});
	await cacheRemoteFileInNativeStore(file, {
		documentId,
		ownerId,
		driveFileId: fileId
	});
}

export async function downloadBrowserDriveFile({
	client,
	fileId,
	maximumBytes
}: {
	client: DriveMediaClientLike;
	fileId: string;
	maximumBytes: number;
}): Promise<Blob> {
	const safeFileId = validDriveId(fileId);
	const safeMaximumBytes = validMaximumBytes(maximumBytes);
	const local = await localDriveDocument(safeFileId);
	if (local && local.sizeBytes <= safeMaximumBytes) {
		return await readNativeDocumentBlob(local);
	}
	try {
		const { data, response } = await invokeDriveMedia(client, {
			operation: 'download',
			fileId: safeFileId,
			maximumBytes: safeMaximumBytes
		});
		if (!(data instanceof Blob) || data.size < 1 || data.size > safeMaximumBytes) {
			throw new Error('invalid drive media response');
		}
		const mediaType = response?.headers.get('X-Drive-Media-Type')?.trim() ?? '';
		const media =
			mediaType.length > 0 && mediaType.length <= 256 && mediaType.includes('/')
				? data.slice(0, data.size, mediaType)
				: data;
		void warmNativeDriveCache(safeFileId, media).catch(() => undefined);
		return media;
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar o arquivo selecionado no Google Drive.');
	}
}

export async function downloadBrowserDriveRange({
	client,
	fileId,
	start,
	endExclusive,
	totalBytes
}: {
	client: DriveMediaClientLike;
	fileId: string;
	start: number;
	endExclusive: number;
	totalBytes: number;
}): Promise<Blob> {
	const safeFileId = validDriveId(fileId);
	const range = validDriveDownloadRange(start, endExclusive, totalBytes);
	const local = await localDriveDocument(safeFileId);
	if (local && local.sizeBytes === range.totalBytes) {
		const bytes = await readNativeDocumentRange(local.documentId, range.start, range.endExclusive);
		return new Blob([bytes.buffer], { type: local.mimeType });
	}
	try {
		return await readDriveMediaRange({
			client,
			fileId: safeFileId,
			start: range.start,
			endExclusive: range.endExclusive,
			totalBytes: range.totalBytes
		});
	} catch (error) {
		if (error instanceof TypeError && error.message.startsWith('Invalid Google Drive')) throw error;
		throw new Error('Não foi possível baixar parte do arquivo selecionado no Google Drive.');
	}
}
