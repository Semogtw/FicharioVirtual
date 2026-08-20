import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

const DEFAULT_CHUNK_BYTES = 256 * 1024;
const MAX_SAFE_CHUNK_BYTES = 512 * 1024;

export type NativeDocument = Readonly<{
	documentId: string;
	ownerId: string;
	originalFilename: string;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	localState: 'present' | 'missing' | 'corrupt';
	remoteState: 'pending' | 'synced' | 'remote-only';
	remoteDocumentId: string | null;
	driveFileId: string | null;
	createdAtMs: number;
	updatedAtMs: number;
	lastAccessedAtMs: number;
}>;

export type NativeStatus = Readonly<{
	platform: string;
	schemaVersion: number;
	localDocumentCount: number;
	pendingSyncCount: number;
	diskUsageBytes: number;
	maxDocumentBytes: number;
	maxIpcChunkBytes: number;
}>;

export type NativeImportOptions = Readonly<{
	documentId: string;
	ownerId: string;
	remoteState?: 'pending' | 'synced';
	remoteDocumentId?: string | null;
	driveFileId?: string | null;
	chunkBytes?: number;
	onProgress?: (completedBytes: number, totalBytes: number) => void;
}>;

export type ByteRange = Readonly<{ start: number; endExclusive: number }>;

function positiveSafeInteger(value: number, label: string) {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new TypeError(`${label} must be a positive integer`);
	return value;
}

export function nativeImportRanges(
	size: number,
	chunkBytes = DEFAULT_CHUNK_BYTES
): readonly ByteRange[] {
	positiveSafeInteger(size, 'size');
	positiveSafeInteger(chunkBytes, 'chunkBytes');
	if (chunkBytes > MAX_SAFE_CHUNK_BYTES) throw new TypeError('chunkBytes exceeds native IPC limit');
	const ranges: ByteRange[] = [];
	for (let start = 0; start < size; start += chunkBytes) {
		ranges.push(Object.freeze({ start, endExclusive: Math.min(size, start + chunkBytes) }));
	}
	return Object.freeze(ranges);
}

function request<T extends Record<string, unknown>>(value: T) {
	return { request: value } as const;
}

function validNativeDocument(value: NativeDocument | null): value is NativeDocument {
	return (
		value !== null &&
		typeof value.documentId === 'string' &&
		typeof value.ownerId === 'string' &&
		typeof value.originalFilename === 'string' &&
		typeof value.mimeType === 'string' &&
		Number.isSafeInteger(value.sizeBytes) &&
		value.sizeBytes > 0 &&
		typeof value.sha256 === 'string' &&
		value.sha256.length === 64
	);
}

export async function getNativeStatus(): Promise<NativeStatus | null> {
	if (!isNativeRuntime()) return null;
	return await invokeNative<NativeStatus>('native_status');
}

export async function resolveNativeDocument(documentId: string): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const result = await invokeNative<NativeDocument | null>(
		'get_local_document',
		request({ documentId })
	);
	return validNativeDocument(result) ? result : null;
}

export async function resolveNativeDocumentByDriveFileId(
	driveFileId: string
): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const result = await invokeNative<NativeDocument | null>(
		'get_local_document_by_drive_file_id',
		request({ driveFileId })
	);
	return validNativeDocument(result) ? result : null;
}

export async function importFileIntoNativeStore(
	file: File,
	options: NativeImportOptions
): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	if (!(file instanceof Blob) || file.size < 1) throw new TypeError('A non-empty file is required');
	const status = await getNativeStatus();
	const maximum = status?.maxDocumentBytes ?? 2 * 1024 * 1024 * 1024;
	if (file.size > maximum) throw new Error('O arquivo excede o limite do armazenamento local.');
	const chunkBytes = Math.min(
		options.chunkBytes ?? DEFAULT_CHUNK_BYTES,
		status?.maxIpcChunkBytes ?? MAX_SAFE_CHUNK_BYTES,
		MAX_SAFE_CHUNK_BYTES
	);
	const ranges = nativeImportRanges(file.size, chunkBytes);
	await invokeNative<void>(
		'begin_local_import',
		request({
			documentId: options.documentId,
			ownerId: options.ownerId,
			originalFilename: file.name || 'documento',
			mimeType: file.type || 'application/octet-stream',
			expectedSize: file.size,
			remoteState: options.remoteState ?? 'pending',
			remoteDocumentId: options.remoteDocumentId ?? null,
			driveFileId: options.driveFileId ?? null
		})
	);
	try {
		for (const range of ranges) {
			const bytes = new Uint8Array(await file.slice(range.start, range.endExclusive).arrayBuffer());
			try {
				await invokeNative<number>(
					'append_local_import',
					request({ documentId: options.documentId, chunk: Array.from(bytes) })
				);
			} finally {
				bytes.fill(0);
			}
			options.onProgress?.(range.endExclusive, file.size);
		}
		const document = await invokeNative<NativeDocument>(
			'finish_local_import',
			request({ documentId: options.documentId })
		);
		if (!validNativeDocument(document))
			throw new Error('O runtime nativo retornou um documento inválido.');
		return document;
	} catch (error) {
		await invokeNative<void>(
			'abort_local_import',
			request({ documentId: options.documentId })
		).catch(() => undefined);
		throw error;
	}
}

export async function cacheRemoteFileInNativeStore(
	file: File,
	options: Omit<NativeImportOptions, 'remoteState'>
): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const existing = await resolveNativeDocument(options.documentId);
	if (existing?.localState === 'present' && existing.sizeBytes === file.size) {
		await markNativeDocumentRemoteSynced({
			documentId: options.documentId,
			remoteDocumentId: options.remoteDocumentId,
			driveFileId: options.driveFileId
		});
		return (await resolveNativeDocument(options.documentId)) ?? existing;
	}
	return await importFileIntoNativeStore(file, { ...options, remoteState: 'synced' });
}

export async function readNativeDocumentRange(
	documentId: string,
	start: number,
	endExclusive: number
): Promise<Uint8Array> {
	if (!isNativeRuntime()) throw new Error('O documento não está em um runtime nativo.');
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(endExclusive) ||
		start < 0 ||
		endExclusive <= start ||
		endExclusive - start > MAX_SAFE_CHUNK_BYTES
	) {
		throw new TypeError('Invalid native document range');
	}
	const raw = await invokeNative<number[]>(
		'read_local_document_range',
		request({ documentId, start, endExclusive })
	);
	const bytes = Uint8Array.from(raw);
	if (bytes.byteLength !== endExclusive - start) {
		bytes.fill(0);
		throw new Error('O runtime nativo retornou uma faixa incompleta.');
	}
	return bytes;
}

export async function readNativeDocumentBlob(document: NativeDocument): Promise<Blob> {
	const parts: BlobPart[] = [];
	for (const range of nativeImportRanges(document.sizeBytes, DEFAULT_CHUNK_BYTES)) {
		const bytes = await readNativeDocumentRange(
			document.documentId,
			range.start,
			range.endExclusive
		);
		parts.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
	}
	return new Blob(parts, { type: document.mimeType });
}

export async function verifyNativeDocument(documentId: string, fullHash = false) {
	if (!isNativeRuntime()) return false;
	return await invokeNative<boolean>('verify_local_document', request({ documentId, fullHash }));
}

export async function markNativeDocumentRemoteSynced(options: {
	documentId: string;
	remoteDocumentId?: string | null;
	driveFileId?: string | null;
}) {
	if (!isNativeRuntime()) return;
	await invokeNative<void>(
		'mark_native_remote_synced',
		request({
			documentId: options.documentId,
			remoteDocumentId: options.remoteDocumentId ?? null,
			driveFileId: options.driveFileId ?? null
		})
	);
}
