import {
	importFileIntoNativeStore,
	resolveNativeDocument,
	type NativeDocument
} from '$lib/native/local-document-store';
import { isNativeRuntime } from '$lib/platform/native-bridge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_SAMPLE_BYTES = 64 * 1024;

export class NativeOriginalPendingError extends Error {
	readonly documentId: string;
	readonly cause: unknown;

	constructor(documentId: string, cause: unknown) {
		super('O original está salvo neste dispositivo e aguarda sincronização com o Drive.');
		this.name = 'NativeOriginalPendingError';
		this.documentId = documentId;
		this.cause = cause;
	}
}

function uuidFromBytes(bytes: Uint8Array) {
	const value = new Uint8Array(bytes.slice(0, 16));
	value[6] = ((value[6] ?? 0) & 0x0f) | 0x80;
	value[8] = ((value[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function concatBytes(parts: readonly Uint8Array[]) {
	const size = parts.reduce((total, part) => total + part.byteLength, 0);
	const combined = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		combined.set(part, offset);
		offset += part.byteLength;
	}
	return combined;
}

async function stableUuid(ownerId: string, resumeKey: string | null, file: File) {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('Secure hashing is unavailable in the native runtime.');
	const encoder = new TextEncoder();
	const identity = resumeKey?.trim();
	let input: Uint8Array;
	if (identity) {
		input = encoder.encode(`fichario-native-v2\0${ownerId}\0resume\0${identity}`);
	} else {
		const firstEnd = Math.min(file.size, ID_SAMPLE_BYTES);
		const lastStart = Math.max(firstEnd, file.size - ID_SAMPLE_BYTES);
		const [first, last] = await Promise.all([
			file.slice(0, firstEnd).arrayBuffer(),
			file.slice(lastStart).arrayBuffer()
		]);
		input = concatBytes([
			encoder.encode(
				`fichario-native-v2\0${ownerId}\0file\0${file.name}\0${file.type}\0${file.size}\0${file.lastModified}\0`
			),
			new Uint8Array(first),
			new Uint8Array(last)
		]);
	}
	const digestInput = new Uint8Array(input.byteLength);
	digestInput.set(input);
	try {
		const digest = new Uint8Array(await subtle.digest('SHA-256', digestInput.buffer));
		return uuidFromBytes(digest);
	} finally {
		input.fill(0);
		digestInput.fill(0);
	}
}

export async function nativeImportDocumentId({
	ownerId,
	resumeKey,
	file
}: {
	ownerId: string;
	resumeKey?: string | null;
	file: File;
}) {
	if (!isNativeRuntime()) return null;
	if (!UUID.test(ownerId)) throw new TypeError('Invalid native import owner');
	if (!(file instanceof Blob) || file.size < 1) throw new TypeError('A non-empty file is required');
	return await stableUuid(ownerId, resumeKey?.trim() || null, file);
}

export async function ensurePendingNativeOriginal({
	file,
	ownerId,
	documentId,
	resumeKey
}: {
	file: File;
	ownerId: string;
	documentId?: string | null;
	resumeKey?: string | null;
}): Promise<NativeDocument | null> {
	if (!isNativeRuntime()) return null;
	const resolvedDocumentId =
		documentId ?? (await nativeImportDocumentId({ ownerId, resumeKey, file }));
	if (!resolvedDocumentId || !UUID.test(resolvedDocumentId)) {
		throw new TypeError('Invalid native import document identifier');
	}
	const existing = await resolveNativeDocument(resolvedDocumentId);
	if (existing) {
		if (
			existing.ownerId !== ownerId ||
			existing.sizeBytes !== file.size ||
			existing.mimeType !== file.type ||
			existing.originalFilename !== file.name
		) {
			throw new Error('A entrada local desta importação não corresponde ao arquivo selecionado.');
		}
		return existing;
	}
	return await importFileIntoNativeStore(file, {
		documentId: resolvedDocumentId,
		ownerId,
		remoteState: 'pending'
	});
}
