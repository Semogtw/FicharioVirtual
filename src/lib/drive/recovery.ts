import { z } from 'zod';
import { getSupabaseClient } from '$lib/services/supabase';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import { parseDriveFile } from './contracts';
import type { DriveFile } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_RECOVERY_ITEMS = 100;

export interface MissingDriveDocument {
	id: string;
	title: string;
	kind: 'image' | 'pdf';
	originalFilename: string;
	notebookId: string | null;
	driveFileId: string;
	updatedAt: string;
}

export type DriveRecoveryConflictKind =
	| 'ambiguous_order'
	| 'identity_mismatch'
	| 'remote_deleted_local_changed'
	| 'local_deleted_remote_changed';

export interface OpenDriveConflict {
	id: string;
	documentId: string | null;
	notebookId: string | null;
	kind: DriveRecoveryConflictKind;
	localSnapshot: Readonly<Record<string, unknown>>;
	remoteSnapshot: Readonly<Record<string, unknown>>;
	createdAt: string;
}

export interface DriveRecoveryState {
	missingDocuments: readonly MissingDriveDocument[];
	openConflicts: readonly OpenDriveConflict[];
}

export type DriveRecoveryClientLike = {
	from(name: 'documents' | 'drive_conflicts'): {
		select(columns: string): {
			eq(
				column: string,
				value: unknown
			): {
				order(
					column: string,
					options: { ascending: boolean }
				): Promise<{
					data: unknown;
					error: unknown;
				}>;
			};
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
	rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
};

const missingSchema = z
	.object({
		id: z.string().regex(UUID),
		title: z.string().trim().min(1).max(240),
		kind: z.enum(['image', 'pdf']),
		original_filename: z.string().trim().min(1).max(512),
		notebook_id: z.string().regex(UUID).nullable(),
		drive_file_id: z.string().regex(DRIVE_ID),
		updated_at: z.string().refine(isIsoTimestamp)
	})
	.strict();

const conflictSchema = z
	.object({
		id: z.string().regex(UUID),
		document_id: z.string().regex(UUID).nullable(),
		notebook_id: z.string().regex(UUID).nullable(),
		kind: z.enum([
			'ambiguous_order',
			'identity_mismatch',
			'remote_deleted_local_changed',
			'local_deleted_remote_changed'
		]),
		local_snapshot: z.record(z.string().min(1).max(128), z.unknown()),
		remote_snapshot: z.record(z.string().min(1).max(128), z.unknown()),
		created_at: z.string().refine(isIsoTimestamp)
	})
	.strict()
	.refine((value) => value.document_id !== null || value.notebook_id !== null);

function hasForbiddenSnapshotKey(value: unknown, depth = 0): boolean {
	if (depth > 8) return true;
	if (Array.isArray(value)) {
		return value.length > 100 || value.some((item) => hasForbiddenSnapshotKey(item, depth + 1));
	}
	if (value === null || typeof value !== 'object') {
		return typeof value === 'string' && value.length > 4_096;
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > 100) return true;
	return entries.some(
		([key, item]) =>
			/(?:access|refresh|id)[_-]?token|secret|authorization/i.test(key) ||
			hasForbiddenSnapshotKey(item, depth + 1)
	);
}

function freezeSnapshot(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
	const clone = structuredClone(value) as Record<string, unknown>;
	function freezeDeep(item: unknown): unknown {
		if (Array.isArray(item)) {
			for (const child of item) freezeDeep(child);
			return Object.freeze(item);
		}
		if (item !== null && typeof item === 'object') {
			for (const child of Object.values(item as Record<string, unknown>)) freezeDeep(child);
			return Object.freeze(item);
		}
		return item;
	}
	return freezeDeep(clone) as Readonly<Record<string, unknown>>;
}

function duplicateIds<T extends { id: string }>(items: readonly T[]): boolean {
	return new Set(items.map((item) => item.id)).size !== items.length;
}

export function parseMissingDriveDocuments(value: unknown): readonly MissingDriveDocument[] {
	const result = z.array(missingSchema).max(MAX_RECOVERY_ITEMS).safeParse(value);
	if (!result.success) throw new TypeError('Invalid Drive recovery response');
	const items = result.data.map((row) =>
		Object.freeze({
			id: row.id,
			title: row.title,
			kind: row.kind,
			originalFilename: row.original_filename,
			notebookId: row.notebook_id,
			driveFileId: row.drive_file_id,
			updatedAt: row.updated_at
		})
	);
	if (duplicateIds(items)) throw new TypeError('Invalid Drive recovery response');
	return Object.freeze(items);
}

export function parseOpenDriveConflicts(value: unknown): readonly OpenDriveConflict[] {
	const result = z.array(conflictSchema).max(MAX_RECOVERY_ITEMS).safeParse(value);
	if (!result.success) throw new TypeError('Invalid Drive recovery response');
	const items = result.data.map((row) => {
		if (
			hasForbiddenSnapshotKey(row.local_snapshot) ||
			hasForbiddenSnapshotKey(row.remote_snapshot)
		) {
			throw new TypeError('Invalid Drive recovery response');
		}
		return Object.freeze({
			id: row.id,
			documentId: row.document_id,
			notebookId: row.notebook_id,
			kind: row.kind,
			localSnapshot: freezeSnapshot(row.local_snapshot),
			remoteSnapshot: freezeSnapshot(row.remote_snapshot),
			createdAt: row.created_at
		});
	});
	if (duplicateIds(items)) throw new TypeError('Invalid Drive recovery response');
	return Object.freeze(items);
}

function defaultClient(): DriveRecoveryClientLike {
	return getSupabaseClient() as unknown as DriveRecoveryClientLike;
}

export async function listDriveRecovery(
	client: DriveRecoveryClientLike = defaultClient()
): Promise<Readonly<DriveRecoveryState>> {
	try {
		const [documentsResponse, conflictsResponse] = await Promise.all([
			client
				.from('documents')
				.select('id,title,kind,original_filename,notebook_id,drive_file_id,updated_at')
				.eq('physical_state', 'missing')
				.order('updated_at', { ascending: false }),
			client
				.from('drive_conflicts')
				.select('id,document_id,notebook_id,kind,local_snapshot,remote_snapshot,created_at')
				.is('resolved_at', null)
				.order('created_at', { ascending: false })
		]);
		if (documentsResponse.error || conflictsResponse.error) throw new Error('query failed');
		return Object.freeze({
			missingDocuments: parseMissingDriveDocuments(documentsResponse.data),
			openConflicts: parseOpenDriveConflicts(conflictsResponse.data)
		});
	} catch {
		throw new Error('Não foi possível carregar a recuperação do Google Drive.');
	}
}

export async function reconnectMissingDriveDocument(
	input: { documentId: string; file: DriveFile },
	client: DriveRecoveryClientLike = defaultClient()
): Promise<void> {
	if (!UUID.test(input.documentId)) throw new TypeError('Invalid document identifier');
	const file = parseDriveFile(input.file);
	if (file.trashed || file.parents.length !== 1) {
		throw new TypeError('Invalid Drive file response');
	}
	try {
		const { data, error } = await client.rpc('reconnect_missing_drive_document', {
			target_document_id: input.documentId,
			target_drive_file_id: file.id,
			target_drive_parent_folder_id: file.parents[0],
			target_drive_mime_type: file.mimeType,
			target_drive_modified_time: file.modifiedTime,
			target_drive_version: file.version,
			target_drive_md5_checksum: file.md5Checksum
		});
		if (error || data !== true) throw new Error('reconnect failed');
	} catch {
		throw new Error('Não foi possível reconectar o original no Google Drive.');
	}
}
