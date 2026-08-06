import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteBrowserDriveFile } from '$lib/drive/browser-files';
import { uploadBrowserBlobToDrive } from '$lib/drive/browser-upload';
import { resolveDriveFolder } from '$lib/drive/resolve-folder';
import type { DriveFile } from '$lib/drive/types';
import { parseDuplicateDocumentId } from '$lib/import/duplicate-result';
import { getSupabaseClient } from '$lib/services/supabase';
import type { Database } from '$lib/types/database';
import {
	PdfUploadError,
	parsePdfImportPublication,
	uploadPdfWithGateway,
	type PdfCreateImportInput,
	type PdfImportGateway,
	type PdfUploadDependencies,
	type PdfUploadOptions,
	type PdfImportPublication
} from './upload';

export interface DrivePdfOperations {
	resolveFolder(notebookId: string | null): Promise<string>;
	uploadOriginal(blob: Blob, name: string, parentFolderId: string): Promise<DriveFile>;
	deleteDriveFile(fileId: string): Promise<void>;
}

class DrivePdfGateway implements PdfImportGateway {
	readonly #client: SupabaseClient<Database>;
	readonly #notebookId: string | null;
	readonly #operations: DrivePdfOperations;
	#driveFile: DriveFile | null = null;
	#originalLogicalPath: string | null = null;

	constructor(
		client: SupabaseClient<Database>,
		notebookId: string | null,
		operations: DrivePdfOperations
	) {
		this.#client = client;
		this.#notebookId = notebookId;
		this.#operations = operations;
	}

	async currentUserId() {
		const { data, error } = await this.#client.auth.getSession();
		if (error || data.session === null) throw new PdfUploadError('not_authenticated');
		return data.session.user.id;
	}

	async findDuplicate(sha256: string) {
		const { data, error } = await this.#client
			.from('documents')
			.select('id')
			.eq('sha256', sha256)
			.maybeSingle();
		if (error) throw new PdfUploadError('duplicate_check_failed');
		try {
			return parseDuplicateDocumentId(data);
		} catch {
			throw new PdfUploadError('duplicate_check_failed');
		}
	}

	async upload(path: string, blob: Blob) {
		if (path.endsWith('/original.pdf')) {
			if (this.#driveFile !== null) throw new PdfUploadError('upload_failed');
			const parentFolderId = await this.#operations.resolveFolder(this.#notebookId);
			const name = blob instanceof File && blob.name.trim() ? blob.name : 'documento.pdf';
			this.#driveFile = await this.#operations.uploadOriginal(blob, name, parentFolderId);
			this.#originalLogicalPath = path;
			return;
		}
		const { error } = await this.#client.storage.from('documents').upload(path, blob, {
			contentType: blob.type,
			cacheControl: '86400',
			upsert: false
		});
		if (error) throw new PdfUploadError('upload_failed');
	}

	async remove(paths: readonly string[]) {
		const temporaryPaths = paths.filter((path) => path !== this.#originalLogicalPath);
		await Promise.allSettled([
			temporaryPaths.length === 0
				? Promise.resolve()
				: this.#client.storage.from('documents').remove(temporaryPaths),
		this.#driveFile === null
				? Promise.resolve()
				: this.#operations.deleteDriveFile(this.#driveFile.id)
		]);
	}

	async createImport(input: PdfCreateImportInput): Promise<PdfImportPublication> {
		if (this.#driveFile === null || this.#driveFile.parents.length !== 1) {
			throw new PdfUploadError('metadata_failed');
		}
		type RpcClient = {
			rpc(
				name: 'create_drive_pdf_import',
				args: Record<string, unknown>
			): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
		};
		const { data, error } = await (this.#client as unknown as RpcClient).rpc(
			'create_drive_pdf_import',
			{
				target_document_id: input.documentId,
				target_notebook_id: input.notebookId,
				document_title: input.title,
				original_filename: input.originalFilename,
				target_drive_file_id: this.#driveFile.id,
				target_drive_parent_folder_id: this.#driveFile.parents[0],
				target_drive_mime_type: this.#driveFile.mimeType,
				target_drive_modified_time: this.#driveFile.modifiedTime,
				target_drive_version: this.#driveFile.version,
				target_drive_md5_checksum: this.#driveFile.md5Checksum,
				prepared_sha256: input.sha256,
				source_created_at: input.sourceCreatedAt,
				page_descriptors: input.pages,
				prompt_version: input.promptVersion
			}
		);
		if (error) throw new PdfUploadError('metadata_failed');
		try {
			return parsePdfImportPublication(data, input.documentId);
		} catch {
			throw new PdfUploadError('metadata_failed');
		}
	}
}

export function createDrivePdfGateway(
	client: SupabaseClient<Database>,
	notebookId: string | null,
	operations?: DrivePdfOperations
): PdfImportGateway {
	const resolvedOperations: DrivePdfOperations =
		operations ??
		Object.freeze({
			resolveFolder: (targetNotebookId: string | null) =>
				resolveDriveFolder(targetNotebookId, client as never),
			uploadOriginal: (blob: Blob, name: string, parentFolderId: string) =>
				uploadBrowserBlobToDrive({
					client: client as never,
					blob,
					name,
					parentFolderId
				}),
			deleteDriveFile: (fileId: string) =>
				deleteBrowserDriveFile({ client: client as never, fileId })
		});
	return new DrivePdfGateway(client, notebookId, resolvedOperations);
}

export function uploadPdfToDrive(
	file: File,
	options: PdfUploadOptions,
	client: SupabaseClient<Database> = getSupabaseClient(),
	dependencies?: PdfUploadDependencies
) {
	return uploadPdfWithGateway(
		file,
		options,
		createDrivePdfGateway(client, options.notebookId ?? null),
		dependencies
	);
}
