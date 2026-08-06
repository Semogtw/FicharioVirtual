import { z } from 'zod';
import { getSupabaseClient } from './supabase';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';

export type DriveJobOperation =
	| 'create_folder'
	| 'rename_folder'
	| 'move_folder'
	| 'update_file'
	| 'delete_permanently';
export type DriveJobStatus =
	| 'pending'
	| 'processing'
	| 'retryable'
	| 'synced'
	| 'conflict'
	| 'failed'
	| 'cancelled';

export interface DriveJobListItem {
	id: string;
	operation: DriveJobOperation;
	status: DriveJobStatus;
	attemptCount: number;
	nextRetryAt: string | null;
	lastErrorCode: string | null;
	lastErrorMessage: string | null;
	createdAt: string;
	finishedAt: string | null;
}

export interface DriveJobReceipt {
	status: 'completed' | 'partial';
	processed: number;
	synced: number;
	retryable: number;
	conflicts: number;
}

export type DriveJobsClientLike = {
	from(name: 'drive_sync_jobs'): {
		select(columns: string): {
			order(
				column: 'created_at',
				options: { ascending: false }
			): {
				limit(count: 100): Promise<{ data: unknown; error: unknown }>;
			};
		};
	};
	functions: {
		invoke(
			name: 'drive-run-jobs',
			options: { body: Record<string, never> }
		): Promise<{ data: unknown; error: unknown }>;
	};
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operation = z.enum([
	'create_folder',
	'rename_folder',
	'move_folder',
	'update_file',
	'delete_permanently'
]);
const status = z.enum([
	'pending',
	'processing',
	'retryable',
	'synced',
	'conflict',
	'failed',
	'cancelled'
]);
const rowSchema = z
	.object({
		id: z.string().regex(UUID),
		operation,
		status,
		attempt_count: z.number().int().min(0).max(50),
		next_retry_at: z.string().refine(isIsoTimestamp).nullable(),
		last_error_code: z
			.string()
			.regex(/^[a-z0-9_]{1,64}$/)
			.nullable(),
		last_error_message: z.string().max(500).nullable(),
		created_at: z.string().refine(isIsoTimestamp),
		finished_at: z.string().refine(isIsoTimestamp).nullable()
	})
	.strict();
const receiptSchema = z
	.object({
		status: z.enum(['completed', 'partial']),
		processed: z.number().int().min(0).max(25),
		synced: z.number().int().min(0).max(25),
		retryable: z.number().int().min(0).max(25),
		conflicts: z.number().int().min(0).max(25)
	})
	.strict()
	.refine((value) => value.synced + value.retryable + value.conflicts === value.processed)
	.refine((value) => value.status !== 'partial' || value.processed === 25);

function defaultClient(): DriveJobsClientLike {
	return getSupabaseClient() as unknown as DriveJobsClientLike;
}

export function parseDriveJobReceipt(value: unknown): DriveJobReceipt {
	const result = receiptSchema.safeParse(value);
	if (!result.success) throw new TypeError('Invalid Drive job receipt');
	return Object.freeze(result.data);
}

export async function runPendingDriveJobs(
	client: DriveJobsClientLike = defaultClient()
): Promise<DriveJobReceipt> {
	try {
		const { data, error } = await client.functions.invoke('drive-run-jobs', { body: {} });
		if (error) throw error;
		return parseDriveJobReceipt(data);
	} catch {
		throw new Error('Não foi possível executar a fila do Google Drive.');
	}
}

export async function listDriveJobs(
	client: DriveJobsClientLike = defaultClient()
): Promise<readonly DriveJobListItem[]> {
	try {
		const { data, error } = await client
			.from('drive_sync_jobs')
			.select(
				'id,operation,status,attempt_count,next_retry_at,last_error_code,last_error_message,created_at,finished_at'
			)
			.order('created_at', { ascending: false })
			.limit(100);
		if (error) throw error;
		const parsed = z.array(rowSchema).max(100).parse(data);
		if (new Set(parsed.map((row) => row.id)).size !== parsed.length) {
			throw new TypeError('Duplicate Drive jobs');
		}
		return Object.freeze(
			parsed.map((row) =>
				Object.freeze({
					id: row.id,
					operation: row.operation,
					status: row.status,
					attemptCount: row.attempt_count,
					nextRetryAt: row.next_retry_at,
					lastErrorCode: row.last_error_code,
					lastErrorMessage: row.last_error_message,
					createdAt: row.created_at,
					finishedAt: row.finished_at
				})
			)
		);
	} catch {
		throw new Error('Não foi possível carregar a fila do Google Drive.');
	}
}
