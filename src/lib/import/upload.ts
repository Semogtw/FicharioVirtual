import { markNativeDocumentRemoteSynced } from '$lib/native/local-document-store';
import {
	ensurePendingNativeOriginal,
	NativeOriginalPendingError
} from '$lib/native/pending-import';
import { writeLocalMediaPreview } from '$lib/pwa/media-preview-cache';
import { sessionState } from '$lib/stores/session.svelte';
import { requireDriveForUpload } from '$lib/stores/drive-upload-gate.svelte';
import type { PreparedImage } from './image-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_STORAGE_PATH = /^drive:([A-Za-z0-9_-]{10,256})$/;

export type UploadPreparedImageInput = {
	prepared: PreparedImage;
	title?: string;
	notebookId?: string | null;
	sourceCreatedAt?: string | null;
	promptVersion?: number;
	signal?: AbortSignal;
	nativeDocumentId?: string | null;
};

export type ImageImportIdentifiers = {
	documentId: string;
	pageId: string;
	ocrJobId: string;
};

export type UploadedPage = ImageImportIdentifiers & {
	sha256: string;
	storagePath: string;
	thumbnailPath: string;
};

export class DuplicateImageError extends Error {
	readonly documentId: string;

	constructor(documentId: string) {
		super('Esta imagem já está no fichário.');
		this.name = 'DuplicateImageError';
		this.documentId = documentId;
	}
}

export class ImageUploadError extends Error {
	readonly code:
		'not_authenticated' | 'duplicate_check_failed' | 'upload_failed' | 'metadata_failed';

	constructor(code: ImageUploadError['code']) {
		const messages = {
			not_authenticated: 'Entre novamente antes de enviar arquivos.',
			duplicate_check_failed: 'Não foi possível verificar se a imagem já existe.',
			upload_failed: 'Não foi possível enviar a imagem agora.',
			metadata_failed: 'A imagem foi enviada, mas o registro não pôde ser concluído.'
		} as const;
		super(messages[code]);
		this.name = 'ImageUploadError';
		this.code = code;
	}
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function invalidImageImportResult(): never {
	throw new TypeError('Invalid image import result');
}

export function parseImageImportResult(
	data: unknown,
	expected: ImageImportIdentifiers
): Readonly<ImageImportIdentifiers> {
	if (
		!UUID.test(expected.documentId) ||
		!UUID.test(expected.pageId) ||
		!UUID.test(expected.ocrJobId) ||
		!Array.isArray(data) ||
		data.length !== 1
	) {
		invalidImageImportResult();
	}
	const row = data[0];
	if (row === null || typeof row !== 'object' || Array.isArray(row)) {
		invalidImageImportResult();
	}
	const value = row as Record<string, unknown>;
	if (!hasExactKeys(value, ['document_id', 'page_id', 'ocr_job_id'])) {
		invalidImageImportResult();
	}
	const documentId = value.document_id;
	const pageId = value.page_id;
	const ocrJobId = value.ocr_job_id;
	if (
		typeof documentId !== 'string' ||
		!UUID.test(documentId) ||
		documentId !== expected.documentId ||
		typeof pageId !== 'string' ||
		!UUID.test(pageId) ||
		pageId !== expected.pageId ||
		typeof ocrJobId !== 'string' ||
		!UUID.test(ocrJobId) ||
		ocrJobId !== expected.ocrJobId
	) {
		invalidImageImportResult();
	}
	return Object.freeze({ documentId, pageId, ocrJobId });
}

function warmImportedImagePreview(input: UploadPreparedImageInput, uploaded: UploadedPage) {
	const ownerId = sessionState.user?.id;
	const driveMatch = DRIVE_STORAGE_PATH.exec(uploaded.storagePath);
	if (!ownerId || !driveMatch?.[1]) return;
	void writeLocalMediaPreview(
		{
			ownerId,
			documentId: uploaded.documentId,
			pageId: uploaded.pageId,
			sourceId: driveMatch[1],
			kind: 'image'
		},
		input.prepared.image
	);
}

export async function uploadPreparedImage(input: UploadPreparedImageInput): Promise<UploadedPage> {
	const ownerId = sessionState.user?.id ?? null;
	const pending = ownerId
		? await ensurePendingNativeOriginal({ file: input.prepared.original, ownerId })
		: null;
	const nativeDocumentId = pending?.documentId ?? null;
	try {
		await requireDriveForUpload();
	} catch (error) {
		if (nativeDocumentId) throw new NativeOriginalPendingError(nativeDocumentId, error);
		throw error;
	}

	const { uploadPreparedImageToDrive } = await import('./drive-upload');
	try {
		const uploaded = await uploadPreparedImageToDrive({ ...input, nativeDocumentId });
		warmImportedImagePreview(input, uploaded);
		return uploaded;
	} catch (error) {
		if (nativeDocumentId && error instanceof DuplicateImageError) {
			await markNativeDocumentRemoteSynced({
				documentId: nativeDocumentId,
				remoteDocumentId: error.documentId
			}).catch(() => undefined);
			throw error;
		}
		if (
			nativeDocumentId &&
			!(error instanceof ImageUploadError && error.code === 'not_authenticated')
		) {
			throw new NativeOriginalPendingError(nativeDocumentId, error);
		}
		throw error;
	}
}
