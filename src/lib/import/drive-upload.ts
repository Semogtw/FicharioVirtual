import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteBrowserDriveFile } from '$lib/drive/browser-files';
import { uploadBrowserBlobToDrive } from '$lib/drive/browser-upload';
import { resolveDriveFolder } from '$lib/drive/resolve-folder';
import type { DriveFile } from '$lib/drive/types';
import {
	importFileIntoNativeStore,
	markNativeDocumentRemoteSynced
} from '$lib/native/local-document-store';
import { getSupabaseClient } from '$lib/services/supabase';
import type { Database } from '$lib/types/database';
import { parseDuplicateDocumentId } from './duplicate-result';
import { calculateSha256 } from './hash';
import type { ImagePreprocessingMetadata } from './image-types';
import {
	DuplicateImageError,
	ImageUploadError,
	parseImageImportResult,
	type ImageImportIdentifiers,
	type UploadPreparedImageInput,
	type UploadedPage
} from './upload';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DriveUploadedPage = UploadedPage;

export type DriveImageCreateImportInput = {
	documentId: string;
	pageId: string;
	ocrJobId: string;
	notebookId: string | null;
	title: string;
	originalFilename: string;
	driveFile: DriveFile;
	ocrPath: string;
	thumbnailPath: string;
	preparedSha256: string;
	sourceSha256: string;
	preprocessing: ImagePreprocessingMetadata;
	originalBytes: number;
	preparedBytes: number;
	sourceCreatedAt: string | null;
	promptVersion: number;
};

export interface DriveImageImportGateway {
	currentUserId(): Promise<string>;
	findDuplicate(sha256: string): Promise<string | null>;
	resolveFolder(notebookId: string | null): Promise<string>;
	uploadOriginal(blob: Blob, name: string, parentFolderId: string): Promise<DriveFile>;
	uploadTemporary(path: string, blob: Blob): Promise<void>;
	removeTemporary(paths: readonly string[]): Promise<void>;
	deleteDriveFile(fileId: string): Promise<void>;
	createImport(input: DriveImageCreateImportInput): Promise<Readonly<ImageImportIdentifiers>>;
}

export type DriveImageUploadDependencies = {
	calculateSha256(input: Blob | ArrayBuffer | ArrayBufferView): Promise<string>;
	generateUuid(): string;
};

function abortError() {
	return new DOMException('Image upload was cancelled', 'AbortError');
}

function extension(blob: Blob) {
	return blob.type === 'image/webp' ? 'webp' : 'jpg';
}

function defaultTitle(filename: string) {
	const value = filename.replace(/\.[^.]+$/, '').trim();
	return value.slice(0, 240) || 'Imagem sem título';
}

function requireUuid(value: string, label: string): string {
	if (!UUID.test(value)) throw new TypeError(`Invalid ${label}`);
	return value;
}

function validateBoundaryInput(input: UploadPreparedImageInput) {
	if (input.signal?.aborted) throw abortError();
	const promptVersion = input.promptVersion ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	if (!(input.prepared.original instanceof File) || input.prepared.original.size < 1) {
		throw new TypeError('Invalid source image');
	}
	if (input.notebookId !== null && input.notebookId !== undefined) {
		requireUuid(input.notebookId, 'notebook identifier');
	}
	if (input.nativeDocumentId !== null && input.nativeDocumentId !== undefined) {
		requireUuid(input.nativeDocumentId, 'native document identifier');
	}
}

const defaultDependencies: DriveImageUploadDependencies = {
	calculateSha256,
	generateUuid() {
		const value = globalThis.crypto?.randomUUID?.();
		if (!value) throw new Error('Secure UUID generation is unavailable');
		return value;
	}
};

async function cleanup(
	gateway: DriveImageImportGateway,
	driveFileId: string | null,
	temporaryPaths: readonly string[]
) {
	await Promise.allSettled([
		temporaryPaths.length === 0 ? Promise.resolve() : gateway.removeTemporary(temporaryPaths),
		driveFileId === null ? Promise.resolve() : gateway.deleteDriveFile(driveFileId)
	]);
}

export async function uploadPreparedImageToDriveWithGateway(
	input: UploadPreparedImageInput,
	gateway: DriveImageImportGateway,
	dependencies: DriveImageUploadDependencies = defaultDependencies
): Promise<DriveUploadedPage> {
	validateBoundaryInput(input);
	const promptVersion = input.promptVersion ?? 1;

	const [userId, preparedSha256, sourceSha256] = await Promise.all([
		gateway.currentUserId(),
		dependencies.calculateSha256(input.prepared.image),
		dependencies.calculateSha256(input.prepared.original)
	]);
	requireUuid(userId, 'user identifier');
	const duplicateId = await gateway.findDuplicate(preparedSha256);
	if (duplicateId) throw new DuplicateImageError(duplicateId);
	if (input.signal?.aborted) throw abortError();

	const documentId = input.nativeDocumentId
		? requireUuid(input.nativeDocumentId, 'native document identifier')
		: requireUuid(dependencies.generateUuid(), 'document identifier');
	const pageId = requireUuid(dependencies.generateUuid(), 'page identifier');
	const ocrJobId = requireUuid(dependencies.generateUuid(), 'OCR job identifier');
	if (!input.nativeDocumentId) {
		await importFileIntoNativeStore(input.prepared.original, {
			documentId,
			ownerId: userId,
			remoteState: 'pending'
		});
	}
	if (input.signal?.aborted) throw abortError();
	const parentFolderId = await gateway.resolveFolder(input.notebookId ?? null);
	if (input.signal?.aborted) throw abortError();

	let driveFile: DriveFile | null = null;
	const ocrPath = `${userId}/${documentId}/ocr.${extension(input.prepared.image)}`;
	const thumbnailPath = `${userId}/${documentId}/thumbnail.${extension(input.prepared.thumbnail)}`;
	const temporaryPaths: string[] = [];
	try {
		driveFile = await gateway.uploadOriginal(
			input.prepared.original,
			input.prepared.originalName,
			parentFolderId
		);
		if (driveFile.parents.length !== 1 || driveFile.parents[0] !== parentFolderId) {
			throw new ImageUploadError('upload_failed');
		}
		if (input.signal?.aborted) throw abortError();
		await gateway.uploadTemporary(ocrPath, input.prepared.image);
		temporaryPaths.push(ocrPath);
		if (input.signal?.aborted) throw abortError();
		await gateway.uploadTemporary(thumbnailPath, input.prepared.thumbnail);
		temporaryPaths.push(thumbnailPath);
		if (input.signal?.aborted) throw abortError();
		const imported = await gateway.createImport({
			documentId,
			pageId,
			ocrJobId,
			notebookId: input.notebookId ?? null,
			title: input.title?.trim() || defaultTitle(input.prepared.originalName),
			originalFilename: input.prepared.originalName,
			driveFile,
			ocrPath,
			thumbnailPath,
			preparedSha256,
			sourceSha256,
			preprocessing: input.prepared.preprocessing,
			originalBytes: input.prepared.original.size,
			preparedBytes: input.prepared.image.size,
			sourceCreatedAt: input.sourceCreatedAt ?? null,
			promptVersion
		});
		await markNativeDocumentRemoteSynced({
			documentId,
			remoteDocumentId: documentId,
			driveFileId: driveFile.id
		});
		return Object.freeze({
			...imported,
			sha256: preparedSha256,
			storagePath: `drive:${driveFile.id}`,
			thumbnailPath
		});
	} catch (error) {
		await cleanup(gateway, driveFile?.id ?? null, temporaryPaths);
		throw error;
	}
}

class SupabaseDriveImageGateway implements DriveImageImportGateway {
	readonly #client: SupabaseClient<Database>;

	constructor(client: SupabaseClient<Database>) {
		this.#client = client;
	}

	async currentUserId() {
		const { data, error } = await this.#client.auth.getSession();
		if (error || data.session === null) throw new ImageUploadError('not_authenticated');
		return data.session.user.id;
	}

	async findDuplicate(sha256: string) {
		const { data, error } = await this.#client
			.from('documents')
			.select('id')
			.eq('sha256', sha256)
			.maybeSingle();
		if (error) throw new ImageUploadError('duplicate_check_failed');
		try {
			return parseDuplicateDocumentId(data);
		} catch {
			throw new ImageUploadError('duplicate_check_failed');
		}
	}

	resolveFolder(notebookId: string | null) {
		return resolveDriveFolder(notebookId, this.#client as never);
	}

	uploadOriginal(blob: Blob, name: string, parentFolderId: string) {
		return uploadBrowserBlobToDrive({
			client: this.#client as never,
			blob,
			name,
			parentFolderId
		});
	}

	async uploadTemporary(path: string, blob: Blob) {
		const { error } = await this.#client.storage.from('documents').upload(path, blob, {
			contentType: blob.type,
			cacheControl: '86400',
			upsert: false
		});
		if (error) throw new ImageUploadError('upload_failed');
	}

	async removeTemporary(paths: readonly string[]) {
		if (paths.length > 0) await this.#client.storage.from('documents').remove([...paths]);
	}

	deleteDriveFile(fileId: string) {
		return deleteBrowserDriveFile({ client: this.#client as never, fileId });
	}

	async createImport(input: DriveImageCreateImportInput) {
		type RpcClient = {
			rpc(
				name: 'create_drive_image_import_v2',
				args: Record<string, unknown>
			): Promise<{ data: unknown; error: unknown }>;
		};
		const preprocessing = input.preprocessing;
		const { data, error } = await (this.#client as unknown as RpcClient).rpc(
			'create_drive_image_import_v2',
			{
				target_document_id: input.documentId,
				target_page_id: input.pageId,
				target_job_id: input.ocrJobId,
				target_notebook_id: input.notebookId,
				document_title: input.title,
				original_filename: input.originalFilename,
				target_drive_file_id: input.driveFile.id,
				target_drive_parent_folder_id: input.driveFile.parents[0],
				target_drive_mime_type: input.driveFile.mimeType,
				target_drive_modified_time: input.driveFile.modifiedTime,
				target_drive_version: input.driveFile.version,
				target_drive_md5_checksum: input.driveFile.md5Checksum,
				ocr_storage_path: input.ocrPath,
				thumbnail_storage_path: input.thumbnailPath,
				prepared_sha256: input.preparedSha256,
				source_sha256: input.sourceSha256,
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
				preprocessing_original_bytes: input.originalBytes,
				preprocessing_prepared_bytes: input.preparedBytes,
				source_created_at: input.sourceCreatedAt,
				prompt_version: input.promptVersion
			}
		);
		if (error) throw new ImageUploadError('metadata_failed');
		try {
			return parseImageImportResult(data, {
				documentId: input.documentId,
				pageId: input.pageId,
				ocrJobId: input.ocrJobId
			});
		} catch {
			throw new ImageUploadError('metadata_failed');
		}
	}
}

export function uploadPreparedImageToDrive(
	input: UploadPreparedImageInput,
	client?: SupabaseClient<Database>
) {
	validateBoundaryInput(input);
	return uploadPreparedImageToDriveWithGateway(
		input,
		new SupabaseDriveImageGateway(client ?? getSupabaseClient())
	);
}
