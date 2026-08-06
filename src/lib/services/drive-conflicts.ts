import { z } from 'zod';
import { getSupabaseClient } from './supabase';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

export type DriveConflictKind =
	| 'ambiguous_order'
	| 'identity_mismatch'
	| 'remote_deleted_local_changed'
	| 'local_deleted_remote_changed';
export type DriveConflictResolution = 'retry_local' | 'mark_missing';

export interface DriveConflictListItem {
	id: string;
	documentId: string | null;
	notebookId: string | null;
	kind: DriveConflictKind;
	createdAt: string;
}

export type DriveConflictsClientLike = {
	from(name: 'drive_conflicts'): {
		select(columns: string): {
			is(column: 'resolved_at', value: null): {
				order(column: 'created_at', options: { ascending: false }): {
					limit(count: 100): Promise<{ data: unknown; error: unknown }>;
				};
			};
		};
	};
	rpc(
		name: 'resolve_drive_conflict',
		args: {
			target_conflict_id: string;
			target_resolution: DriveConflictResolution;
		}
	): Promise<{ data: unknown; error: unknown }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
		created_at: z.string().refine(isIsoTimestamp)
	})
	.strict()
	.refine((value) => value.document_id !== null || value.notebook_id !== null);

function defaultClient(): DriveConflictsClientLike {
	return getSupabaseClient() as unknown as DriveConflictsClientLike;
}

export async function listOpenDriveConflicts(
	client: DriveConflictsClientLike = defaultClient()
): Promise<readonly DriveConflictListItem[]> {
	try {
		const { data, error } = await client
			.from('drive_conflicts')
			.select('id,document_id,notebook_id,kind,created_at')
			.is('resolved_at', null)
			.order('created_at', { ascending: false })
			.limit(100);
		if (error) throw error;
		const parsed = z.array(conflictSchema).max(100).parse(data);
		if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
			throw new TypeError('Duplicate Drive conflicts');
		}
		return Object.freeze(
			parsed.map((item) =>
				Object.freeze({
					id: item.id,
					documentId: item.document_id,
					notebookId: item.notebook_id,
					kind: item.kind,
					createdAt: item.created_at
				})
			)
		);
	} catch {
		throw new Error('Não foi possível carregar os conflitos do Google Drive.');
	}
}

export async function resolveDriveConflict(
	conflictId: string,
	resolution: DriveConflictResolution,
	client: DriveConflictsClientLike = defaultClient()
): Promise<void> {
	try {
		if (!UUID.test(conflictId) || !['retry_local', 'mark_missing'].includes(resolution)) {
			throw new TypeError('Invalid Drive conflict resolution');
		}
		const { data, error } = await client.rpc('resolve_drive_conflict', {
			target_conflict_id: conflictId,
			target_resolution: resolution
		});
		if (error || data !== true) throw error ?? new Error('resolution rejected');
	} catch {
		throw new Error('Não foi possível resolver o conflito do Google Drive.');
	}
}
