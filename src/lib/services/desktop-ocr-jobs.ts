import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;
const STATUSES = new Set([
	'pending',
	'processing',
	'ready',
	'retryable',
	'blocked_quota',
	'needs_review',
	'failed',
	'waiting_desktop'
]);

export type DesktopOcrJobStatus =
	| 'pending'
	| 'processing'
	| 'ready'
	| 'retryable'
	| 'blocked_quota'
	| 'needs_review'
	| 'failed'
	| 'waiting_desktop';

export type DesktopOcrJob = Readonly<{
	id: string;
	pageId: string;
	documentId: string;
	documentTitle: string;
	pageNumber: number;
	status: DesktopOcrJobStatus;
	attemptCount: number;
	lastErrorCode: string | null;
	deviceId: string | null;
	deviceLabel: string | null;
	leaseStartedAt: string | null;
	leaseExpiresAt: string | null;
	leaseExpired: boolean;
	createdAt: string;
	updatedAt: string;
}>;

export class DesktopOcrJobsError extends Error {
	constructor(message = 'Não foi possível carregar a fila de OCR local.') {
		super(message);
		this.name = 'DesktopOcrJobsError';
	}
}

type QueueRpcClient = {
	rpc(
		name: 'list_desktop_ocr_jobs',
		args?: Record<string, never>
	): Promise<{ data: unknown; error: unknown }>;
};

function timestamp(value: unknown, nullable = false): string | null {
	if (value === null && nullable) return null;
	if (typeof value !== 'string' || value.length < 20 || value.length > 64) return null;
	return Number.isFinite(Date.parse(value)) ? value : null;
}

function nullableUuid(value: unknown) {
	return value === null || (typeof value === 'string' && UUID.test(value));
}

function parseJob(value: unknown): DesktopOcrJob | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const leaseStartedAt = timestamp(record.lease_started_at, true);
	const leaseExpiresAt = timestamp(record.lease_expires_at, true);
	const createdAt = timestamp(record.created_at);
	const updatedAt = timestamp(record.updated_at);
	const status =
		typeof record.status === 'string' && STATUSES.has(record.status) ? record.status : null;

	if (
		typeof record.job_id !== 'string' ||
		!UUID.test(record.job_id) ||
		typeof record.page_id !== 'string' ||
		!UUID.test(record.page_id) ||
		typeof record.document_id !== 'string' ||
		!UUID.test(record.document_id) ||
		typeof record.document_title !== 'string' ||
		record.document_title.length < 1 ||
		record.document_title.length > 240 ||
		!Number.isSafeInteger(record.page_number) ||
		Number(record.page_number) < 1 ||
		status === null ||
		!Number.isSafeInteger(record.attempt_count) ||
		Number(record.attempt_count) < 0 ||
		Number(record.attempt_count) > 20 ||
		(record.last_error_code !== null &&
			(typeof record.last_error_code !== 'string' || !ERROR_CODE.test(record.last_error_code))) ||
		!nullableUuid(record.device_id) ||
		(record.device_label !== null &&
			(typeof record.device_label !== 'string' ||
				record.device_label.length < 1 ||
				record.device_label.length > 80)) ||
		(record.device_id === null) !== (record.device_label === null) ||
		(record.lease_started_at !== null && leaseStartedAt === null) ||
		(record.lease_expires_at !== null && leaseExpiresAt === null) ||
		(record.lease_started_at === null) !== (record.lease_expires_at === null) ||
		typeof record.lease_expired !== 'boolean' ||
		createdAt === null ||
		updatedAt === null
	) {
		return null;
	}

	if (
		status === 'processing' &&
		(record.device_id === null || leaseStartedAt === null || leaseExpiresAt === null)
	) {
		return null;
	}
	if (status !== 'processing' && record.lease_expired) return null;

	return Object.freeze({
		id: record.job_id,
		pageId: record.page_id,
		documentId: record.document_id,
		documentTitle: record.document_title,
		pageNumber: Number(record.page_number),
		status: status as DesktopOcrJobStatus,
		attemptCount: Number(record.attempt_count),
		lastErrorCode: record.last_error_code as string | null,
		deviceId: record.device_id as string | null,
		deviceLabel: record.device_label as string | null,
		leaseStartedAt,
		leaseExpiresAt,
		leaseExpired: record.lease_expired,
		createdAt: createdAt as string,
		updatedAt: updatedAt as string
	});
}

function parseJobs(value: unknown): readonly DesktopOcrJob[] | null {
	if (!Array.isArray(value) || value.length > 100) return null;
	const jobs: DesktopOcrJob[] = [];
	for (const item of value) {
		const parsed = parseJob(item);
		if (!parsed) return null;
		jobs.push(parsed);
	}
	return Object.freeze(jobs);
}

function gateway(client?: SupabaseClient<Database>): QueueRpcClient {
	return (client ?? getSupabaseClient()) as unknown as QueueRpcClient;
}

export async function listDesktopOcrJobs(
	client?: SupabaseClient<Database>
): Promise<readonly DesktopOcrJob[]> {
	let result: { data: unknown; error: unknown };
	try {
		result = await gateway(client).rpc('list_desktop_ocr_jobs');
	} catch {
		throw new DesktopOcrJobsError();
	}
	if (result.error) throw new DesktopOcrJobsError();
	const jobs = parseJobs(result.data);
	if (!jobs) throw new DesktopOcrJobsError('A fila de OCR local retornou um formato inválido.');
	return jobs;
}
