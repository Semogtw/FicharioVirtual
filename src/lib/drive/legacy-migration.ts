import { z } from 'zod';
import { deleteBrowserDriveFile } from './browser-files';
import { uploadBrowserBlobToDrive, type DriveTokenClientLike } from './browser-upload';
import { resolveDriveFolder } from './resolve-folder';
import type { DriveFile } from './types';
import { getSupabaseClient } from '$lib/services/supabase';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/original\.(?:pdf|webp|png|jpe?g)$/i;
const MAX_LEGACY_DOCUMENTS = 100;

export interface LegacyDriveDocument {
	id: string;
	title: string;
	kind: 'image' | 'pdf';
	originalFilename: string;
	storagePath: string;
	notebookId: string | null;
	createdAt: string;
}

export interface LegacyDriveMigrationGateway {
	downloadLegacyOriginal(storagePath: string): Promise<Blob>;
	resolveFolder(notebookId: string | null): Promise<string>;
	uploadOriginal(
		blob: Blob,
		name: string,
		parentFolderId: string,
		documentId: string
	): Promise<DriveFile>;
	publishMigration(input: {
		documentId: string;
		storagePath: string;
		file: DriveFile;
	}): Promise<void>;
	deleteDriveFile(fileId: string): Promise<void>;
}

export type LegacyMigrationClientLike = DriveTokenClientLike & {
	from(name: 'documents'): {
		select(columns: string): {
			not(
				column: string,
				operator: 'is',
				value: null
			): {
				is(
					column: string,
					value: null
				): {
					order(
						column: string,
						options: { ascending: boolean }
					): Promise<{
						data: unknown;
						error: unknown;
					}>;
				};
			};
		};
	};
	storage: {
		from(bucket: 'documents'): {
			download(path: string): Promise<{ data: Blob | null; error: unknown }>;
		};
	};
	rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const legacySchema = z
	.object({
		id: z.string().regex(UUID),
		title: z.string().trim().min(1).max(240),
		kind: z.enum(['image', 'pdf']),
		original_filename: z.string().trim().min(1).max(512),
		storage_path: z.string().regex(STORAGE_PATH),
		notebook_id: z.string().regex(UUID).nullable(),
		created_at: z.string().refine(isIsoTimestamp)
	})
	.strict();

export function parseLegacyDriveDocuments(value: unknown): readonly LegacyDriveDocument[] {
	const result = z.array(legacySchema).max(MAX_LEGACY_DOCUMENTS).safeParse(value);
	if (!result.success) throw new TypeError('Invalid legacy Drive migration response');
	const documents = result.data.map((row) =>
		Object.freeze({
			id: row.id,
			title: row.title,
			kind: row.kind,
			originalFilename: row.original_filename,
			storagePath: row.storage_path,
			notebookId: row.notebook_id,
			createdAt: row.created_at
		})
	);
	if (new Set(documents.map((document) => document.id)).size !== documents.length) {
		throw new TypeError('Invalid legacy Drive migration response');
	}
	return Object.freeze(documents);
}

function defaultClient(): LegacyMigrationClientLike {
	return getSupabaseClient() as unknown as LegacyMigrationClientLike;
}

export async function listLegacyDriveDocuments(
	client: LegacyMigrationClientLike = defaultClient()
): Promise<readonly LegacyDriveDocument[]> {
	try {
		const { data, error } = await client
			.from('documents')
			.select('id,title,kind,original_filename,storage_path,notebook_id,created_at')
			.not('storage_path', 'is', null)
			.is('drive_file_id', null)
			.order('created_at', { ascending: true });
		if (error) throw error;
		return parseLegacyDriveDocuments(data);
	} catch {
		throw new Error('Não foi possível carregar os originais legados para migração.');
	}
}

function blobMatchesDocument(blob: Blob, document: LegacyDriveDocument): boolean {
	if (blob.size < 1 || blob.size > 20 * 1024 * 1024) return false;
	if (document.kind === 'pdf') return blob.type === 'application/pdf';
	return ['image/jpeg', 'image/png', 'image/webp'].includes(blob.type);
}

export async function migrateLegacyDriveDocumentWithGateway(
	document: LegacyDriveDocument,
	gateway: LegacyDriveMigrationGateway
): Promise<DriveFile> {
	const blob = await gateway.downloadLegacyOriginal(document.storagePath);
	if (!blobMatchesDocument(blob, document)) {
		throw new Error('O original legado não corresponde ao documento.');
	}
	const parentFolderId = await gateway.resolveFolder(document.notebookId);
	const file = new File([blob], document.originalFilename, { type: blob.type });
	const uploaded = await gateway.uploadOriginal(
		file,
		document.originalFilename,
		parentFolderId,
		document.id
	);
	try {
		await gateway.publishMigration({
			documentId: document.id,
			storagePath: document.storagePath,
			file: uploaded
		});
		return uploaded;
	} catch (error) {
		await gateway.deleteDriveFile(uploaded.id).catch(() => undefined);
		throw error;
	}
}

export function createLegacyDriveMigrationGateway(
	client: LegacyMigrationClientLike = defaultClient()
): LegacyDriveMigrationGateway {
	return Object.freeze({
		async downloadLegacyOriginal(storagePath) {
			if (!STORAGE_PATH.test(storagePath)) {
				throw new TypeError('Invalid legacy Storage path');
			}
			const { data, error } = await client.storage.from('documents').download(storagePath);
			if (error || data === null) {
				throw new Error('Não foi possível baixar o original legado do Supabase.');
			}
			return data;
		},
		resolveFolder(notebookId) {
			return resolveDriveFolder(notebookId, client as never);
		},
		uploadOriginal(blob, name, parentFolderId) {
			return uploadBrowserBlobToDrive({
				client,
				blob,
				name,
				parentFolderId
			});
		},
		async publishMigration({ documentId, storagePath, file }) {
			if (file.parents.length !== 1 || file.trashed) {
				throw new TypeError('Invalid Drive file response');
			}
			const { data, error } = await client.rpc('complete_drive_legacy_migration', {
				target_document_id: documentId,
				expected_storage_path: storagePath,
				target_drive_file_id: file.id,
				target_drive_parent_folder_id: file.parents[0],
				target_drive_mime_type: file.mimeType,
				target_drive_modified_time: file.modifiedTime,
				target_drive_version: file.version,
				target_drive_md5_checksum: file.md5Checksum
			});
			if (error || data !== true) {
				throw new Error('Não foi possível publicar a migração do original no Google Drive.');
			}
		},
		deleteDriveFile(fileId) {
			return deleteBrowserDriveFile({ client, fileId });
		}
	});
}

export function migrateLegacyDriveDocument(
	document: LegacyDriveDocument,
	client: LegacyMigrationClientLike = defaultClient()
): Promise<DriveFile> {
	return migrateLegacyDriveDocumentWithGateway(document, createLegacyDriveMigrationGateway(client));
}
