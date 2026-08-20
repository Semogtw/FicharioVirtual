import {
	importFileIntoNativeStore,
	resolveNativeDocument,
	type NativeDocument
} from '$lib/native/local-document-store';
import { isNativeRuntime } from '$lib/platform/native-bridge';

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function stableUuid(ownerId: string, resumeKey: string) {
	if (!globalThis.crypto?.subtle) {
		throw new Error('Secure hashing is unavailable in the native runtime.');
	}
	const input = new TextEncoder().encode(`fichario-native-v1\0${ownerId}\0${resumeKey}`);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
	return uuidFromBytes(digest);
}

function randomUuid() {
	const value = globalThis.crypto?.randomUUID?.();
	if (!value || !UUID.test(value)) throw new Error('Secure UUID generation is unavailable.');
	return value;
}

export async function nativeImportDocumentId({
	ownerId,
	resumeKey
}: {
	ownerId: string;
	resumeKey?: string | null;
}) {
	if (!isNativeRuntime()) return null;
	if (!UUID.test(ownerId)) throw new TypeError('Invalid native import owner');
	return resumeKey?.trim() ? await stableUuid(ownerId, resumeKey.trim()) : randomUuid();
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
		documentId ?? (await nativeImportDocumentId({ ownerId, resumeKey }));
	if (!resolvedDocumentId || !UUID.test(resolvedDocumentId)) {
		throw new TypeError('Invalid native import document identifier');
	}
	const existing = await resolveNativeDocument(resolvedDocumentId);
	if (existing) {
		if (
			existing.ownerId !== ownerId ||
			existing.sizeBytes !== file.size ||
			existing.mimeType !== file.type
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
