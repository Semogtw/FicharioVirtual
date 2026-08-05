import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ImportStatus } from '$lib/types/database';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z0-9_]{1,64}$/;
const ACTIVE_STATUSES: readonly ImportStatus[] = [
	'draft',
	'preparing',
	'uploading',
	'processing',
	'paused',
	'failed'
];
const SELECT_FIELDS =
	'id,user_id,status,total_items,prepared_items,uploaded_items,completed_items,last_error_code,local_resume_key,created_at,updated_at,finished_at';

export type ImportSession = Readonly<{
	id: string;
	userId: string;
	status: ImportStatus;
	totalItems: number;
	preparedItems: number;
	uploadedItems: number;
	completedItems: number;
	lastErrorCode: string | null;
	localResumeKey: string | null;
	createdAt: string;
	updatedAt: string;
	finishedAt: string | null;
}>;

export type CreateImportSessionInput = {
	localResumeKey: string;
	totalItems: number;
};

export type UpdateImportSessionInput = {
	status: ImportStatus;
	totalItems: number;
	preparedItems: number;
	uploadedItems: number;
	completedItems: number;
	lastErrorCode: string | null;
	finishedAt: string | null;
};

type ImportSessionInsert = Database['public']['Tables']['import_sessions']['Insert'];
type ImportSessionUpdate = Database['public']['Tables']['import_sessions']['Update'];

export interface ImportSessionsGateway {
	currentUserId(): Promise<string>;
	create(input: ImportSessionInsert): Promise<unknown>;
	update(id: string, changes: ImportSessionUpdate): Promise<unknown>;
	listActive(): Promise<unknown>;
	listByResumeKeys(resumeKeys: readonly string[]): Promise<unknown>;
}

export class ImportSessionServiceError extends Error {
	constructor() {
		super('Não foi possível registrar o progresso da importação agora.');
		this.name = 'ImportSessionServiceError';
	}
}

function invalidResponse(): never {
	throw new TypeError('Invalid import session response');
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function isImportStatus(value: unknown): value is ImportStatus {
	return (
		typeof value === 'string' &&
		[
			'draft',
			'preparing',
			'uploading',
			'processing',
			'completed',
			'paused',
			'failed',
			'cancelled'
		].includes(value)
	);
}

function validCounters(total: unknown, prepared: unknown, uploaded: unknown, completed: unknown) {
	return (
		typeof total === 'number' &&
		Number.isInteger(total) &&
		total >= 0 &&
		total <= 10_000 &&
		typeof prepared === 'number' &&
		Number.isInteger(prepared) &&
		prepared >= 0 &&
		prepared <= total &&
		typeof uploaded === 'number' &&
		Number.isInteger(uploaded) &&
		uploaded >= 0 &&
		uploaded <= prepared &&
		typeof completed === 'number' &&
		Number.isInteger(completed) &&
		completed >= 0 &&
		completed <= uploaded
	);
}

function validResumeKey(value: string) {
	if (value.length < 16 || value.length > 160) return false;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 32 || code === 127) return false;
	}
	return true;
}

export function parseImportSession(
	data: unknown,
	expected: { expectedUserId?: string; expectedId?: string } = {}
): ImportSession {
	if (data === null || typeof data !== 'object' || Array.isArray(data)) invalidResponse();
	const row = data as Record<string, unknown>;
	if (
		!hasExactKeys(row, [
			'id',
			'user_id',
			'status',
			'total_items',
			'prepared_items',
			'uploaded_items',
			'completed_items',
			'last_error_code',
			'local_resume_key',
			'created_at',
			'updated_at',
			'finished_at'
		])
	) {
		invalidResponse();
	}

	const id = row.id;
	const userId = row.user_id;
	const status = row.status;
	const lastErrorCode = row.last_error_code;
	const localResumeKey = row.local_resume_key;
	const createdAt = row.created_at;
	const updatedAt = row.updated_at;
	const finishedAt = row.finished_at;
	if (
		typeof id !== 'string' ||
		!UUID.test(id) ||
		(expected.expectedId !== undefined && id !== expected.expectedId) ||
		typeof userId !== 'string' ||
		!UUID.test(userId) ||
		(expected.expectedUserId !== undefined && userId !== expected.expectedUserId) ||
		!isImportStatus(status) ||
		!validCounters(row.total_items, row.prepared_items, row.uploaded_items, row.completed_items) ||
		(lastErrorCode !== null &&
			(typeof lastErrorCode !== 'string' || !ERROR_CODE.test(lastErrorCode))) ||
		(localResumeKey !== null &&
			(typeof localResumeKey !== 'string' || !validResumeKey(localResumeKey))) ||
		typeof createdAt !== 'string' ||
		!isIsoTimestamp(createdAt) ||
		typeof updatedAt !== 'string' ||
		!isIsoTimestamp(updatedAt) ||
		(finishedAt !== null && (typeof finishedAt !== 'string' || !isIsoTimestamp(finishedAt)))
	) {
		invalidResponse();
	}

	return Object.freeze({
		id,
		userId,
		status,
		totalItems: row.total_items as number,
		preparedItems: row.prepared_items as number,
		uploadedItems: row.uploaded_items as number,
		completedItems: row.completed_items as number,
		lastErrorCode,
		localResumeKey,
		createdAt,
		updatedAt,
		finishedAt
	});
}

function validatedCreateInput(input: CreateImportSessionInput) {
	if (
		typeof input.localResumeKey !== 'string' ||
		!validResumeKey(input.localResumeKey) ||
		!Number.isInteger(input.totalItems) ||
		input.totalItems < 1 ||
		input.totalItems > 10_000
	) {
		throw new TypeError('Invalid import session input');
	}
	return input;
}

function validatedUpdateInput(input: UpdateImportSessionInput) {
	if (
		!isImportStatus(input.status) ||
		!validCounters(
			input.totalItems,
			input.preparedItems,
			input.uploadedItems,
			input.completedItems
		) ||
		(input.lastErrorCode !== null && !ERROR_CODE.test(input.lastErrorCode)) ||
		(input.finishedAt !== null && !isIsoTimestamp(input.finishedAt))
	) {
		throw new TypeError('Invalid import session input');
	}
	return input;
}

function validId(id: string) {
	if (!UUID.test(id)) throw new TypeError('Invalid import session identifier');
	return id;
}

export async function createImportSessionWithGateway(
	gateway: ImportSessionsGateway,
	input: CreateImportSessionInput
): Promise<ImportSession> {
	const validated = validatedCreateInput(input);
	const userId = await gateway.currentUserId();
	if (!UUID.test(userId)) throw new ImportSessionServiceError();
	const data = await gateway.create({
		user_id: userId,
		status: 'draft',
		total_items: validated.totalItems,
		prepared_items: 0,
		uploaded_items: 0,
		completed_items: 0,
		last_error_code: null,
		local_resume_key: validated.localResumeKey,
		finished_at: null
	});
	return parseImportSession(data, { expectedUserId: userId });
}

export async function updateImportSessionWithGateway(
	gateway: ImportSessionsGateway,
	id: string,
	input: UpdateImportSessionInput
): Promise<ImportSession> {
	const sessionId = validId(id);
	const validated = validatedUpdateInput(input);
	const data = await gateway.update(sessionId, {
		status: validated.status,
		total_items: validated.totalItems,
		prepared_items: validated.preparedItems,
		uploaded_items: validated.uploadedItems,
		completed_items: validated.completedItems,
		last_error_code: validated.lastErrorCode,
		finished_at: validated.finishedAt
	});
	return parseImportSession(data, { expectedId: sessionId });
}

export async function listActiveImportSessionsWithGateway(
	gateway: ImportSessionsGateway,
	expectedUserId: string
): Promise<readonly ImportSession[]> {
	if (!UUID.test(expectedUserId)) throw new TypeError('Invalid user identifier');
	const data = await gateway.listActive();
	if (!Array.isArray(data) || data.length > 1_000) invalidResponse();
	const ids = new Set<string>();
	const sessions = data.map((row) => {
		const session = parseImportSession(row, { expectedUserId });
		if (ids.has(session.id) || !ACTIVE_STATUSES.includes(session.status)) invalidResponse();
		ids.add(session.id);
		return session;
	});
	return Object.freeze(sessions);
}

export async function listImportSessionsByResumeKeysWithGateway(
	gateway: ImportSessionsGateway,
	expectedUserId: string,
	resumeKeys: readonly string[]
): Promise<readonly ImportSession[]> {
	if (!UUID.test(expectedUserId)) throw new TypeError('Invalid user identifier');
	if (!Array.isArray(resumeKeys) || resumeKeys.length > 1_000) {
		throw new TypeError('Invalid import resume keys');
	}
	const requested = new Set<string>();
	for (const resumeKey of resumeKeys) {
		if (typeof resumeKey !== 'string' || !validResumeKey(resumeKey) || requested.has(resumeKey)) {
			throw new TypeError('Invalid import resume keys');
		}
		requested.add(resumeKey);
	}
	if (requested.size === 0) return Object.freeze([]);

	const data = await gateway.listByResumeKeys(resumeKeys);
	if (!Array.isArray(data) || data.length > requested.size) invalidResponse();
	const ids = new Set<string>();
	const returnedKeys = new Set<string>();
	const sessions = data.map((row) => {
		const session = parseImportSession(row, { expectedUserId });
		const resumeKey = session.localResumeKey;
		if (
			resumeKey === null ||
			!requested.has(resumeKey) ||
			ids.has(session.id) ||
			returnedKeys.has(resumeKey)
		) {
			invalidResponse();
		}
		ids.add(session.id);
		returnedKeys.add(resumeKey);
		return session;
	});
	return Object.freeze(sessions);
}

class SupabaseImportSessionsGateway implements ImportSessionsGateway {
	constructor(private readonly client: SupabaseClient<Database>) {}

	async currentUserId() {
		const { data, error } = await this.client.auth.getSession();
		if (error || data.session === null) throw new ImportSessionServiceError();
		return data.session.user.id;
	}

	async create(input: ImportSessionInsert) {
		const { data, error } = await this.client
			.from('import_sessions')
			.upsert(input, { onConflict: 'user_id,local_resume_key' })
			.select(SELECT_FIELDS)
			.single();
		if (error || data === null) throw new ImportSessionServiceError();
		return data;
	}

	async update(id: string, changes: ImportSessionUpdate) {
		const { data, error } = await this.client
			.from('import_sessions')
			.update(changes)
			.eq('id', id)
			.select(SELECT_FIELDS)
			.single();
		if (error || data === null) throw new ImportSessionServiceError();
		return data;
	}

	async listActive() {
		const { data, error } = await this.client
			.from('import_sessions')
			.select(SELECT_FIELDS)
			.in('status', [...ACTIVE_STATUSES])
			.order('updated_at', { ascending: true })
			.limit(1_000);
		if (error || data === null) throw new ImportSessionServiceError();
		return data;
	}

	async listByResumeKeys(resumeKeys: readonly string[]) {
		const { data, error } = await this.client
			.from('import_sessions')
			.select(SELECT_FIELDS)
			.in('local_resume_key', [...resumeKeys])
			.limit(resumeKeys.length);
		if (error || data === null) throw new ImportSessionServiceError();
		return data;
	}
}

function gateway(client?: SupabaseClient<Database>) {
	return new SupabaseImportSessionsGateway(client ?? getSupabaseClient());
}

export function createImportSession(
	input: CreateImportSessionInput,
	client?: SupabaseClient<Database>
) {
	return createImportSessionWithGateway(gateway(client), input);
}

export function updateImportSession(
	id: string,
	input: UpdateImportSessionInput,
	client?: SupabaseClient<Database>
) {
	return updateImportSessionWithGateway(gateway(client), id, input);
}

export async function listActiveImportSessions(userId: string, client?: SupabaseClient<Database>) {
	try {
		return await listActiveImportSessionsWithGateway(gateway(client), userId);
	} catch (error) {
		if (error instanceof TypeError) throw error;
		throw new ImportSessionServiceError();
	}
}

export async function listImportSessionsByResumeKeys(
	userId: string,
	resumeKeys: readonly string[],
	client?: SupabaseClient<Database>
) {
	try {
		return await listImportSessionsByResumeKeysWithGateway(gateway(client), userId, resumeKeys);
	} catch (error) {
		if (error instanceof TypeError) throw error;
		throw new ImportSessionServiceError();
	}
}
