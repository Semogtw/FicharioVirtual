import { deleteBrowserDriveFile } from '$lib/drive/browser-files';
import { uploadBrowserBlobToDrive } from '$lib/drive/browser-upload';
import { resolveDriveFolder } from '$lib/drive/resolve-folder';
import { processOcrBatch } from '$lib/services/ocr';
import { getSupabaseClient } from '$lib/services/supabase';
import { calculateSha256 } from './hash';
import { prepareImage } from './image-client';
import type { ImagePreparationMode, PreparedImage } from './image-types';
import { parseImageImportResult, uploadPreparedImage, type ImageImportIdentifiers } from './upload';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DOCUMENT_PAGES = 100;

export type PhotoDocumentProgress = Readonly<{
	stage: 'preparing' | 'uploading';
	pageNumber: number;
	pageCount: number;
}>;

export type PhotoDocumentImportResult = Readonly<{
	documentId: string;
	pageIds: readonly string[];
}>;

export type ImportPhotoDocumentOptions = {
	mode?: ImagePreparationMode;
	notebookId?: string | null;
	title?: string;
	signal?: AbortSignal;
	onProgress?: (progress: PhotoDocumentProgress) => void;
};

type AppendPreparedImageInput = {
	prepared: PreparedImage;
	documentId: string;
	pageNumber: number;
	notebookId: string | null;
	promptVersion?: number;
	signal?: AbortSignal;
};

export class PartialPhotoDocumentImportError extends Error {
	readonly documentId: string;
	readonly savedPages: number;

	constructor(documentId: string, savedPages: number, cause?: unknown) {
		super(
			`O documento foi salvo com ${savedPages} página(s), mas não foi possível concluir todas as fotos.`,
			{ cause }
		);
		this.name = 'PartialPhotoDocumentImportError';
		this.documentId = documentId;
		this.savedPages = savedPages;
	}
}

function abortError() {
	return new DOMException('Photo document import was cancelled', 'AbortError');
}

function extension(blob: Blob) {
	return blob.type === 'image/webp' ? 'webp' : 'jpg';
}

function requireUuid(value: string, label: string) {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label}`);
	return value;
}

function generateUuid(label: string) {
	const value = globalThis.crypto?.randomUUID?.();
	if (!value) throw new Error('Secure UUID generation is unavailable');
	return requireUuid(value, label);
}

function validateFiles(files: readonly File[]) {
	if (files.length < 2 || files.length > MAX_DOCUMENT_PAGES) {
		throw new TypeError(`A photo document must contain between 2 and ${MAX_DOCUMENT_PAGES} pages.`);
	}
	for (const file of files) {
		if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
			throw new TypeError('Invalid photo document page.');
		}
	}
}

async function appendPreparedImage(input: AppendPreparedImageInput): Promise<ImageImportIdentifiers> {
	if (input.signal?.aborted) throw abortError();
	const documentId = requireUuid(input.documentId, 'document identifier');
	if (!Number.isInteger(input.pageNumber) || input.pageNumber < 2 || input.pageNumber > 10_000) {
		throw new TypeError('Invalid page number');
	}
	const promptVersion = input.promptVersion ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}

	const client = getSupabaseClient();
	const { data: sessionData, error: sessionError } = await client.auth.getSession();
	if (sessionError || sessionData.session === null) throw new Error('Entre novamente antes de enviar arquivos.');
	const userId = requireUuid(sessionData.session.user.id, 'user identifier');
	const [preparedSha256, sourceSha256, parentFolderId] = await Promise.all([
		calculateSha256(input.prepared.image),
		calculateSha256(input.prepared.original),
		resolveDriveFolder(input.notebookId, client as never)
	]);
	if (input.signal?.aborted) throw abortError();

	const driveFile = await uploadBrowserBlobToDrive({
		client: client as never,
		blob: input.prepared.original,
		name: input.prepared.originalName,
		parentFolderId
	});
	if (driveFile.parents.length !== 1 || driveFile.parents[0] !== parentFolderId) {
		await deleteBrowserDriveFile({ client: client as never, fileId: driveFile.id }).catch(() => undefined);
		throw new Error('Não foi possível confirmar o destino da página no Drive.');
	}

	const pageId = generateUuid('page identifier');
	const ocrJobId = generateUuid('OCR job identifier');
	const ocrPath = `${userId}/${documentId}/pages/${input.pageNumber}/ocr.${extension(input.prepared.image)}`;
	let temporaryUploaded = false;
	try {
		if (input.signal?.aborted) throw abortError();
		const { error: uploadError } = await client.storage.from('documents').upload(ocrPath, input.prepared.image, {
			contentType: input.prepared.image.type,
			cacheControl: '86400',
			upsert: false
		});
		if (uploadError) throw new Error('Não foi possível preparar a página para leitura.');
		temporaryUploaded = true;
		if (input.signal?.aborted) throw abortError();

		type RpcClient = {
			rpc(
				name: 'append_drive_image_page_v1',
				args: Record<string, unknown>
			): Promise<{ data: unknown; error: unknown }>;
		};
		const preprocessing = input.prepared.preprocessing;
		const { data, error } = await (client as unknown as RpcClient).rpc('append_drive_image_page_v1', {
			target_document_id: documentId,
			target_page_id: pageId,
			target_job_id: ocrJobId,
			target_page_number: input.pageNumber,
			target_drive_file_id: driveFile.id,
			target_drive_parent_folder_id: parentFolderId,
			target_drive_mime_type: driveFile.mimeType,
			target_drive_modified_time: driveFile.modifiedTime,
			target_drive_version: driveFile.version,
			target_drive_md5_checksum: driveFile.md5Checksum,
			ocr_storage_path: ocrPath,
			prepared_sha256: preparedSha256,
			source_sha256: sourceSha256,
			preprocessing_profile: preprocessing.profile,
			preprocessing_version: preprocessing.version,
			preprocessing_auto_crop: preprocessing.autoCropApplied,
			preprocessing_retained_permille: preprocessing.retainedAreaPermille,
			preprocessing_deskew_mdeg: preprocessing.deskewMilliDegrees,
			preprocessing_illumination: preprocessing.illuminationNormalized,
			preprocessing_contrast: preprocessing.contrastEnhanced,
			preprocessing_fallback: preprocessing.fallbackToStandard,
			preprocessing_source_width: preprocessing.sourceWidth,
			preprocessing_source_height: preprocessing.sourceHeight,
			preprocessing_prepared_width: preprocessing.preparedWidth,
			preprocessing_prepared_height: preprocessing.preparedHeight,
			preprocessing_original_bytes: input.prepared.original.size,
			preprocessing_prepared_bytes: input.prepared.image.size,
			prompt_version: promptVersion
		});
		if (error) throw new Error('Não foi possível anexar esta página ao documento.');
		return parseImageImportResult(data, { documentId, pageId, ocrJobId });
	} catch (error) {
		await Promise.allSettled([
			temporaryUploaded ? client.storage.from('documents').remove([ocrPath]) : Promise.resolve(),
			deleteBrowserDriveFile({ client: client as never, fileId: driveFile.id })
		]);
		throw error;
	}
}

function defaultTitle(file: File) {
	const title = file.name.replace(/\.[^.]+$/, '').trim();
	return title.slice(0, 240) || 'Anotações';
}

export async function importPhotoDocument(
	files: readonly File[],
	options: ImportPhotoDocumentOptions = {}
): Promise<PhotoDocumentImportResult> {
	validateFiles(files);
	const mode = options.mode ?? 'standard';
	const notebookId = options.notebookId ?? null;
	const firstFile = files[0];
	if (!firstFile) throw new TypeError('Missing first photo document page.');
	const pageIds: string[] = [];
	let documentId: string | null = null;

	try {
		options.onProgress?.({ stage: 'preparing', pageNumber: 1, pageCount: files.length });
		const firstPrepared = await prepareImage(firstFile, mode, { signal: options.signal });
		options.onProgress?.({ stage: 'uploading', pageNumber: 1, pageCount: files.length });
		const first = await uploadPreparedImage({
			prepared: firstPrepared,
			title: options.title?.trim() || defaultTitle(firstFile),
			notebookId,
			signal: options.signal
		});
		documentId = first.documentId;
		pageIds.push(first.pageId);

		for (let index = 1; index < files.length; index += 1) {
			const file = files[index];
			if (!file) continue;
			const pageNumber = index + 1;
			options.onProgress?.({ stage: 'preparing', pageNumber, pageCount: files.length });
			const prepared = await prepareImage(file, mode, { signal: options.signal });
			options.onProgress?.({ stage: 'uploading', pageNumber, pageCount: files.length });
			const uploaded = await appendPreparedImage({
				prepared,
				documentId,
				pageNumber,
				notebookId,
				signal: options.signal
			});
			pageIds.push(uploaded.pageId);
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (documentId !== null) throw new PartialPhotoDocumentImportError(documentId, pageIds.length, error);
		throw error;
	}

	if (documentId === null) throw new Error('O documento não pôde ser criado.');
	void processOcrBatch(pageIds).catch(() => undefined);
	return Object.freeze({ documentId, pageIds: Object.freeze([...pageIds]) });
}
