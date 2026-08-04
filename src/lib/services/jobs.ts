import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RunnableOcrJob = Readonly<{
	pageId: string;
	attemptCount: number;
}>;

export interface OcrJobsGateway {
	recoverStaleJobs(): Promise<void>;
	listRunnableJobs(selectionAt: string, limit: number): Promise<unknown>;
}

export type RunnableOcrOptions = {
	selectionAt?: string;
	limit?: number;
	client?: SupabaseClient<Database>;
};

export class OcrJobsServiceError extends Error {
	constructor() {
		super('Não foi possível localizar as leituras pendentes agora.');
		this.name = 'OcrJobsServiceError';
	}
}

function invalidResponse(): never {
	throw new TypeError('Invalid runnable OCR response');
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

export function parseRunnableOcrJobs(data: unknown): readonly RunnableOcrJob[] {
	if (!Array.isArray(data) || data.length > 100) invalidResponse();
	const ids = new Set<string>();
	const rows = data.map((row) => {
		if (row === null || typeof row !== 'object' || Array.isArray(row)) invalidResponse();
		const record = row as Record<string, unknown>;
		if (!hasExactKeys(record, ['page_id', 'attempt_count'])) invalidResponse();
		const pageId = record.page_id;
		const attemptCount = record.attempt_count;
		if (
			typeof pageId !== 'string' ||
			!UUID.test(pageId) ||
			ids.has(pageId) ||
			typeof attemptCount !== 'number' ||
			!Number.isInteger(attemptCount) ||
			attemptCount < 0 ||
			attemptCount > 2
		) {
			invalidResponse();
		}
		ids.add(pageId);
		return Object.freeze({ pageId, attemptCount });
	});
	return Object.freeze(rows);
}

function validatedOptions(options: Pick<RunnableOcrOptions, 'selectionAt' | 'limit'>) {
	const selectionAt = options.selectionAt ?? new Date().toISOString();
	const limit = options.limit ?? 50;
	if (!isIsoTimestamp(selectionAt) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new TypeError('Invalid runnable OCR selection');
	}
	return { selectionAt, limit };
}

export async function listRunnableOcrJobsWithGateway(
	gateway: OcrJobsGateway,
	options: Pick<RunnableOcrOptions, 'selectionAt' | 'limit'> = {}
): Promise<readonly RunnableOcrJob[]> {
	const { selectionAt, limit } = validatedOptions(options);
	await gateway.recoverStaleJobs();
	return parseRunnableOcrJobs(await gateway.listRunnableJobs(selectionAt, limit));
}

class SupabaseOcrJobsGateway implements OcrJobsGateway {
	constructor(private readonly client: SupabaseClient<Database>) {}

	async recoverStaleJobs() {
		const { error } = await this.client.rpc('recover_stale_ocr_jobs');
		if (error) throw new OcrJobsServiceError();
	}

	async listRunnableJobs(selectionAt: string, limit: number) {
		const { data, error } = await this.client.rpc('list_runnable_ocr_jobs', {
			selection_at: selectionAt,
			result_limit: limit
		});
		if (error) throw new OcrJobsServiceError();
		return data;
	}
}

export async function listRunnableOcrJobs(
	options: RunnableOcrOptions = {}
): Promise<readonly RunnableOcrJob[]> {
	try {
		return await listRunnableOcrJobsWithGateway(
			new SupabaseOcrJobsGateway(options.client ?? getSupabaseClient()),
			options
		);
	} catch (error) {
		if (error instanceof TypeError) throw error;
		throw new OcrJobsServiceError();
	}
}
