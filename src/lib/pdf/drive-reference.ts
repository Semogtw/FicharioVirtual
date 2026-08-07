import type { SupabaseClient } from '@supabase/supabase-js';
import { copyBrowserDriveFile, deleteBrowserDriveFile } from '$lib/drive/browser-files';
import type { DriveTokenClientLike } from '$lib/drive/browser-upload';
import {
	resolveDriveFolder,
	type DriveFolderClientLike
} from '$lib/drive/resolve-folder';
import type { GooglePickerSelection } from '$lib/drive/picker';
import type { DriveFile } from '$lib/drive/types';
import { getSupabaseClient } from '$lib/services/supabase';
import type { Database } from '$lib/types/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MD5 = /^[0-9a-f]{32}$/i;

export type StagedDrivePdfReference = Readonly<{
	documentId: string;
	driveFileId: string;
	sourceSizeBytes: number;
	status: 'pending_inspection';
}>;

type ReferenceClient = DriveTokenClientLike & DriveFolderClientLike & SupabaseClient<Database>;

type StageInput = {
	client: ReferenceClient;
	targetDocumentId: string;
	targetNotebookId: string | null;
	documentTitle: string;
	originalFilename: string;
	targetDriveFileId: string;
	targetDriveParentFolderId: string;
	targetDriveModifiedTime: string;
	targetDriveVersion: string;
	targetDriveMd5Checksum: string | null;
	sourceSizeBytes: number;
	sourceModifiedAt: string;
};

export interface DrivePdfReferenceDependencies {
	createDocumentId(): string;
	resolveFolder(notebookId: string | null, client: ReferenceClient): Promise<string>;
	copyFile(input: {
		client: ReferenceClient;
		sourceFileId: string;
		parentFolderId: string;
		name: string;
	}): Promise<DriveFile>;
	deleteFile(input: { client: ReferenceClient; fileId: string }): Promise<void>;
	stage(input: StageInput): Promise<unknown>;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function validText(value: string, minimum: number, maximum: number) {
	const normalized = value.trim();
	if (normalized.length < minimum || normalized.length > maximum) return null;
	for (const character of normalized) {
		const code = character.codePointAt(0);
		if (code !== undefined && (code < 32 || code === 127)) return null;
	}
	return normalized;
}

function validIsoTimestamp(value: string) {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateSelection(selection: GooglePickerSelection) {
	if (
		selection.mimeType !== 'application/pdf' ||
		!DRIVE_ID.test(selection.id) ||
		validText(selection.name, 1, 512) === null ||
		!Number.isSafeInteger(selection.sizeBytes) ||
		selection.sizeBytes < 1 ||
		!validIsoTimestamp(selection.modifiedAt)
	) {
		throw new TypeError('Invalid Drive PDF reference');
	}
	return selection;
}

function validateCopiedFile(file: DriveFile, parentFolderId: string) {
	if (
		!DRIVE_ID.test(file.id) ||
		file.mimeType !== 'application/pdf' ||
		file.trashed ||
		file.parents.length !== 1 ||
		file.parents[0] !== parentFolderId ||
		!validIsoTimestamp(file.modifiedTime) ||
		!/^\d{1,32}$/.test(file.version) ||
		(file.md5Checksum !== null && !MD5.test(file.md5Checksum))
	) {
		throw new Error('A cópia do PDF no Google Drive não corresponde ao destino esperado.');
	}
	return file;
}

function parseStageResult(
	value: unknown,
	expected: { documentId: string; driveFileId: string; sourceSizeBytes: number }
): StagedDrivePdfReference {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid Drive PDF staging response');
	}
	const record = value as Record<string, unknown>;
	if (
		!hasExactKeys(record, ['documentId', 'driveFileId', 'sourceSizeBytes', 'status']) ||
		record.documentId !== expected.documentId ||
		record.driveFileId !== expected.driveFileId ||
		record.sourceSizeBytes !== expected.sourceSizeBytes ||
		record.status !== 'pending_inspection'
	) {
		throw new TypeError('Invalid Drive PDF staging response');
	}
	return Object.freeze({
		documentId: expected.documentId,
		driveFileId: expected.driveFileId,
		sourceSizeBytes: expected.sourceSizeBytes,
		status: 'pending_inspection'
	});
}

const defaultDependencies: DrivePdfReferenceDependencies = {
	createDocumentId: () => crypto.randomUUID(),
	resolveFolder: resolveDriveFolder,
	copyFile: copyBrowserDriveFile,
	deleteFile: deleteBrowserDriveFile,
	async stage(input) {
		const { data, error } = await input.client.rpc('stage_drive_pdf_reference', {
			target_document_id: input.targetDocumentId,
			target_notebook_id: input.targetNotebookId,
			document_title: input.documentTitle,
			original_filename: input.originalFilename,
			target_drive_file_id: input.targetDriveFileId,
			target_drive_parent_folder_id: input.targetDriveParentFolderId,
			target_drive_modified_time: input.targetDriveModifiedTime,
			target_drive_version: input.targetDriveVersion,
			target_drive_md5_checksum: input.targetDriveMd5Checksum,
			source_size_bytes: input.sourceSizeBytes,
			source_modified_at: input.sourceModifiedAt
		});
		if (error) throw error;
		return data;
	}
};

export async function stageDrivePdfReference({
	selection,
	notebookId,
	title,
	client = getSupabaseClient() as ReferenceClient,
	dependencies = defaultDependencies
}: {
	selection: GooglePickerSelection;
	notebookId: string | null;
	title: string;
	client?: ReferenceClient;
	dependencies?: DrivePdfReferenceDependencies;
}): Promise<StagedDrivePdfReference> {
	const source = validateSelection(selection);
	if (notebookId !== null && !UUID.test(notebookId)) {
		throw new TypeError('Invalid notebook identifier');
	}
	const documentTitle = validText(title, 1, 240);
	if (documentTitle === null) throw new TypeError('Invalid Drive PDF reference');
	const documentId = dependencies.createDocumentId();
	if (!UUID.test(documentId)) throw new TypeError('Invalid Drive PDF reference');

	const parentFolderId = await dependencies.resolveFolder(notebookId, client);
	if (!DRIVE_ID.test(parentFolderId)) throw new TypeError('Invalid Drive PDF reference');
	const copied = validateCopiedFile(
		await dependencies.copyFile({
			client,
			sourceFileId: source.id,
			parentFolderId,
			name: source.name
		}),
		parentFolderId
	);

	try {
		const staged = await dependencies.stage({
			client,
			targetDocumentId: documentId,
			targetNotebookId: notebookId,
			documentTitle,
			originalFilename: source.name,
			targetDriveFileId: copied.id,
			targetDriveParentFolderId: parentFolderId,
			targetDriveModifiedTime: copied.modifiedTime,
			targetDriveVersion: copied.version,
			targetDriveMd5Checksum: copied.md5Checksum,
			sourceSizeBytes: source.sizeBytes,
			sourceModifiedAt: source.modifiedAt
		});
		return parseStageResult(staged, {
			documentId,
			driveFileId: copied.id,
			sourceSizeBytes: source.sizeBytes
		});
	} catch {
		try {
			await dependencies.deleteFile({ client, fileId: copied.id });
		} catch {
			throw new Error(
				'Não foi possível preparar o PDF grande para importação nem remover a cópia criada no Google Drive.'
			);
		}
		throw new Error('Não foi possível preparar o PDF grande para importação.');
	}
}
