import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteBrowserDriveFile } from '$lib/drive/browser-files';
import { uploadBrowserBlobToDrive } from '$lib/drive/browser-upload';
import { resolveDriveFolder } from '$lib/drive/resolve-folder';
import type { DriveFile } from '$lib/drive/types';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from '$lib/services/supabase';
import { parseDuplicateDocumentId } from './duplicate-result';
import { calculateSha256 } from './hash';
import type { PreparedImage } from './image-types';
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
	thumbnailPath: string;
	sha256: string;
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
	if (input.signal?.aborted) throw abortError();
	const promptVersion = input.promptVersion ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	if (input.notebookId !== null && input.notebookId !== undefined) {
		requireUuid(input.notebookId, 'notebook identifier');
	}

	const [userId, sha256] = await Promise.all([
		gateway.currentUserId(),
		dependencies.calculateSha256(input.prepared.image)
	]);
	requireUuid(userId, 'user identifier');
	const duplicateId = await gateway.findDuplicate(sha256);
	if (duplicateId) throw new DuplicateImageError(duplicateId);
	if (input.signal?.aborted) throw abortError();

	const documentId = requireUuid(dependencies.generateUuid(), 'document identifier');
	const pageId = requireUuid(dependencies.generateUuid(), 'page identifier');
	const ocrJobId = requireUuid(dependencies.generateUuid(), 'OCR job identifier');
	const parentFolderId = await gateway.resolveFolder(input.notebookId ?? null);
	if (input.signal?.aborted) throw abortError();

	let driveFile: DriveFile | null = null;
	const thumbnailPath = `${userId}/${documentId}/thumbnail.${extension(input.prepared.thumbnail)}`;
	const temporaryPaths: string[] = [];
	try {
		driveFile = await gateway.uploadOriginal(
			input.prepared.image,
			`${defaultTitle(input.prepared.originalName)}.${extension(input.prepared.image)}`,
			parentFolderId
		);
		if (driveFile.parents.length !== 1 || driveFile.parents[0] !== parentFolderId) {
			throw new ImageUploadError('upload_failed');
		}
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
			thumbnailPath,
			sha256,
			sourceCreatedAt: input.sourceCreatedAt ?? null,
			promptVersion
		});
		return Object.freeze({
			...imported,
			sha256,
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
				name: 'create_drive_image_import',
				args: Record<string, unknown>
			): Promise<{ data: unknown; error: unknown }>;
		};
		const { data, error } = await (this.#client as unknown as RpcClient).rpc(
			'create_drive_image_import',
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
				thumbnail_storage_path: input.thumbnailPath,
				prepared_sha256: input.sha256,
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
	client: SupabaseClient<Database> = getSupabaseClient()
) {
	return uploadPreparedImageToDriveWithGateway(input, new SupabaseDriveImageGateway(client));
}
