import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

export type NativeSyncOperation = 'upload' | 'download' | 'metadata' | 'delete';
export type NativeSyncState = 'pending' | 'running' | 'retry' | 'completed' | 'cancelled';

export type NativeSyncJob = Readonly<{
	id: number;
	documentId: string;
	operation: NativeSyncOperation;
	state: NativeSyncState;
	priority: number;
	attempts: number;
	nextAttemptAtMs: number;
	leaseUntilMs: number | null;
	lastError: string | null;
	payloadJson: string | null;
	createdAtMs: number;
	updatedAtMs: number;
}>;

function request<T extends Record<string, unknown>>(value: T) {
	return { request: value } as const;
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new TypeError(`Invalid ${label}`);
	}
	return value as number;
}

function parseJob(value: unknown): NativeSyncJob {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid native sync job');
	}
	const row = value as Record<string, unknown>;
	const operation = row.operation;
	const state = row.state;
	if (
		typeof row.documentId !== 'string' ||
		row.documentId.length === 0 ||
		!['upload', 'download', 'metadata', 'delete'].includes(operation as string) ||
		!['pending', 'running', 'retry', 'completed', 'cancelled'].includes(state as string) ||
		(typeof row.lastError !== 'string' && row.lastError !== null) ||
		(typeof row.payloadJson !== 'string' && row.payloadJson !== null)
	) {
		throw new TypeError('Invalid native sync job');
	}
	return Object.freeze({
		id: safeInteger(row.id, 'native sync job id', 1),
		documentId: row.documentId,
		operation: operation as NativeSyncOperation,
		state: state as NativeSyncState,
		priority: safeInteger(row.priority, 'native sync priority'),
		attempts: safeInteger(row.attempts, 'native sync attempts'),
		nextAttemptAtMs: safeInteger(row.nextAttemptAtMs, 'native sync retry time'),
		leaseUntilMs:
			row.leaseUntilMs === null ? null : safeInteger(row.leaseUntilMs, 'native sync lease time'),
		lastError: row.lastError,
		payloadJson: row.payloadJson,
		createdAtMs: safeInteger(row.createdAtMs, 'native sync creation time'),
		updatedAtMs: safeInteger(row.updatedAtMs, 'native sync update time')
	});
}

function parseJobs(value: unknown): readonly NativeSyncJob[] {
	if (!Array.isArray(value)) throw new TypeError('Invalid native sync jobs');
	return Object.freeze(value.map(parseJob));
}

function limitValue(value: number, label: string, maximum: number) {
	const normalized = safeInteger(value, label, 1);
	if (normalized > maximum) throw new TypeError(`Invalid ${label}`);
	return normalized;
}

export async function listNativeSyncJobs(limit = 50): Promise<readonly NativeSyncJob[] | null> {
	if (!isNativeRuntime()) return null;
	const normalizedLimit = limitValue(limit, 'native sync limit', 100);
	const result = await invokeNative<unknown>(
		'list_native_sync_jobs',
		request({ limit: normalizedLimit })
	);
	return parseJobs(result);
}

export async function claimNativeSyncJobs(
	options: {
		limit?: number;
		leaseMs?: number;
	} = {}
): Promise<readonly NativeSyncJob[] | null> {
	if (!isNativeRuntime()) return null;
	const limit = limitValue(options.limit ?? 2, 'native sync limit', 20);
	const leaseMs = limitValue(options.leaseMs ?? 60_000, 'native sync lease', 10 * 60_000);
	const result = await invokeNative<unknown>('claim_native_sync_jobs', request({ limit, leaseMs }));
	return parseJobs(result);
}

function jobId(value: number) {
	return safeInteger(value, 'native sync job id', 1);
}

export async function completeNativeSyncJob(id: number): Promise<void | null> {
	if (!isNativeRuntime()) return null;
	await invokeNative<void>('complete_native_sync_job', request({ id: jobId(id) }));
}

export async function failNativeSyncJob(input: {
	id: number;
	error: string;
	retryAfterMs: number;
}): Promise<void | null> {
	if (!isNativeRuntime()) return null;
	const error = input.error.trim();
	if (error.length === 0 || error.length > 2_000) throw new TypeError('Invalid native sync error');
	const retryAfterMs = safeInteger(input.retryAfterMs, 'native sync retry delay');
	await invokeNative<void>(
		'fail_native_sync_job',
		request({ id: jobId(input.id), error, retryAfterMs })
	);
}

export async function cancelNativeSyncJob(input: {
	id: number;
	error: string;
}): Promise<void | null> {
	if (!isNativeRuntime()) return null;
	const error = input.error.trim();
	if (error.length === 0 || error.length > 2_000) throw new TypeError('Invalid native sync error');
	await invokeNative<void>('cancel_native_sync_job', request({ id: jobId(input.id), error }));
}
