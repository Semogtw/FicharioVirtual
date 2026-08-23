import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
	mapDocumentRecord,
	type DocumentCursor,
	type DocumentFilters,
	type DocumentPage,
	type DocumentKind,
	type DocumentRecord,
	type DocumentSummary,
	type DocumentStatus,
	type NewDocumentInput,
	type UpdateDocumentInput
} from '$lib/domain/document';
import type { Database } from '$lib/types/database';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import {
	listNativeDocumentsPage,
	type NativeDocument,
	type NativeDocumentPageCursor
} from '$lib/native/local-document-store';
import { isNativeRuntime } from '$lib/platform/native-bridge';
import { sessionState } from '$lib/stores/session.svelte';
import { getSupabaseClient } from './supabase';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const timestamp = z.string().refine(isIsoTimestamp);
const documentRecordSchema = z
	.object({
		id: z.string().regex(UUID),
		title: z.string().trim().min(1).max(240),
		kind: z.enum(['image', 'pdf']),
		status: z.enum([
			'uploading',
			'pending',
			'processing',
			'ready',
			'partially_ready',
			'needs_review',
			'failed'
		]),
		page_count: z.number().int().min(0).max(10_000),
		thumbnail_path: z.string().min(1).max(1_024).nullable(),
		notebook_id: z.string().regex(UUID).nullable(),
		created_at: timestamp,
		updated_at: timestamp
	})
	.strict();
const documentFiltersSchema = z
	.object({
		notebookId: z.string().regex(UUID).nullable().optional(),
		kind: z.enum(['image', 'pdf']).nullable().optional(),
		status: z
			.enum([
				'uploading',
				'pending',
				'processing',
				'ready',
				'partially_ready',
				'needs_review',
				'failed'
			])
			.nullable()
			.optional(),
		createdFrom: timestamp.nullable().optional(),
		createdTo: timestamp.nullable().optional()
	})
	.strict()
	.superRefine((filters, context) => {
		if (
			filters.createdFrom != null &&
			filters.createdTo != null &&
			Date.parse(filters.createdFrom) > Date.parse(filters.createdTo)
		) {
			context.addIssue({ code: 'custom', message: 'Invalid document date range' });
		}
	});

export function parseDocumentFilters(data: unknown): DocumentFilters {
	const result = documentFiltersSchema.safeParse(data);
	if (!result.success) throw new TypeError('Invalid document filters');
	return Object.freeze(result.data);
}

export function parseDocumentRecords(
	data: unknown,
	maximumRows: number
): readonly DocumentRecord[] {
	if (!Number.isInteger(maximumRows) || maximumRows < 0 || maximumRows > MAX_PAGE_SIZE + 1) {
		throw new TypeError('Invalid document response');
	}
	const result = z.array(documentRecordSchema).max(maximumRows).safeParse(data);
	if (!result.success) throw new TypeError('Invalid document response');
	const ids = new Set<string>();
	const rows = result.data.map((row) => {
		if (ids.has(row.id)) throw new TypeError('Invalid document response');
		ids.add(row.id);
		return Object.freeze(row);
	});
	return Object.freeze(rows);
}

export function parseDocumentRecord(data: unknown, expectedId?: string): DocumentRecord {
	const row = parseDocumentRecords([data], 1)[0];
	if (!row || (expectedId !== undefined && row.id !== expectedId)) {
		throw new TypeError('Invalid document response');
	}
	return row;
}

export class DocumentServiceError extends Error {
	constructor() {
		super('Não foi possível atualizar a biblioteca agora.');
		this.name = 'DocumentServiceError';
	}
}

function clientOrDefault(client?: SupabaseClient<Database>) {
	return client ?? getSupabaseClient();
}

function validId(value: string): string {
	if (!UUID.test(value)) throw new TypeError('Invalid document identifier');
	return value;
}

function validCursor(cursor: DocumentCursor): DocumentCursor {
	if (!UUID.test(cursor.id) || !isIsoTimestamp(cursor.createdAt)) {
		throw new TypeError('Invalid document cursor');
	}
	return cursor;
}

function pageSize(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
		throw new TypeError('Invalid document page size');
	}
	return value;
}

function nativeTimestamp(value: number) {
	if (!Number.isSafeInteger(value) || value < 0) return null;
	const timestamp = new Date(value).toISOString();
	return isIsoTimestamp(timestamp) ? timestamp : null;
}

function nativeTitle(filename: string) {
	const title = filename
		.replace(/\.[^.]+$/u, '')
		.trim()
		.slice(0, 240);
	return title || 'Documento local';
}

function nativeKind(mimeType: string): DocumentKind | null {
	if (mimeType === 'application/pdf') return 'pdf';
	if (mimeType.startsWith('image/')) return 'image';
	return null;
}

function nativeStatus(document: NativeDocument): DocumentStatus {
	if (document.localState !== 'present') return 'failed';
	return document.remoteState === 'pending' ? 'pending' : 'ready';
}

export function mapNativeDocumentSummary(document: NativeDocument): DocumentSummary | null {
	const kind = nativeKind(document.mimeType);
	const createdAt = nativeTimestamp(document.createdAtMs);
	const updatedAt = nativeTimestamp(document.updatedAtMs);
	if (!kind || !createdAt || !updatedAt) return null;
	return Object.freeze({
		id: document.documentId,
		title: nativeTitle(document.originalFilename),
		kind,
		status: nativeStatus(document),
		pageCount: 1,
		thumbnailPath: null,
		notebookId: null,
		createdAt,
		updatedAt
	});
}

async function currentUserId(client: SupabaseClient<Database>): Promise<string> {
	try {
		const { data, error } = await client.auth.getSession();
		if (error || data.session === null || !UUID.test(data.session.user.id)) {
			throw new DocumentServiceError();
		}
		return data.session.user.id;
	} catch {
		throw new DocumentServiceError();
	}
}

export type DocumentPageLoader = (cursor: DocumentCursor | null) => Promise<DocumentPage>;

async function listNativeDocumentFallback(
	filters: DocumentFilters,
	cursor: DocumentCursor | null,
	limit: number
): Promise<DocumentPage | null> {
	if (!isNativeRuntime()) return null;
	const ownerId = sessionState.user?.id;
	if (!ownerId) return null;
	if (filters.notebookId) return Object.freeze({ items: [], nextCursor: null });

	const nativeDocuments: NativeDocument[] = [];
	const seenCursors = new Set<string>();
	let nativeCursor: NativeDocumentPageCursor | null = null;
	while (true) {
		const page = await listNativeDocumentsPage({ limit: 1_000, cursor: nativeCursor });
		if (!page) return null;
		nativeDocuments.push(...page.documents.filter((document) => document.ownerId === ownerId));
		if (!page.nextCursor) break;
		const cursorKey = `${page.nextCursor.lastAccessedAtMs}:${page.nextCursor.documentId}`;
		if (seenCursors.has(cursorKey)) throw new DocumentServiceError();
		seenCursors.add(cursorKey);
		nativeCursor = page.nextCursor;
	}

	let items = nativeDocuments
		.map(mapNativeDocumentSummary)
		.filter((document): document is DocumentSummary => document !== null)
		.filter((document) => {
			if (filters.kind && document.kind !== filters.kind) return false;
			if (filters.status === 'ready' && document.status !== 'ready') return false;
			if (filters.status && filters.status !== 'ready' && document.status !== filters.status) {
				return false;
			}
			if (filters.createdFrom && document.createdAt < filters.createdFrom) return false;
			if (filters.createdTo && document.createdAt > filters.createdTo) return false;
			return true;
		});
	items.sort((left, right) => {
		const byDate = right.createdAt.localeCompare(left.createdAt);
		return byDate || right.id.localeCompare(left.id);
	});
	if (cursor) {
		const index = items.findIndex(
			(item) =>
				item.createdAt < cursor.createdAt ||
				(item.createdAt === cursor.createdAt && item.id < cursor.id)
		);
		items = index < 0 ? [] : items.slice(index);
	}
	const visibleItems = items.slice(0, limit);
	const last = visibleItems.at(-1);
	const hasNextPage = items.length > visibleItems.length;
	return Object.freeze({
		items: Object.freeze(visibleItems),
		nextCursor:
			hasNextPage && last ? Object.freeze({ createdAt: last.createdAt, id: last.id }) : null
	});
}

export async function collectAllDocumentPages(
	loadPage: DocumentPageLoader
): Promise<readonly DocumentSummary[]> {
	const items: DocumentSummary[] = [];
	const seenCursors = new Set<string>();
	let cursor: DocumentCursor | null = null;

	while (true) {
		const page = await loadPage(cursor);
		items.push(...page.items);
		if (page.nextCursor === null) break;

		const nextCursor = validCursor(page.nextCursor);
		const cursorKey = `${nextCursor.createdAt}\n${nextCursor.id}`;
		if (seenCursors.has(cursorKey)) throw new DocumentServiceError();
		seenCursors.add(cursorKey);
		cursor = nextCursor;
	}

	return Object.freeze(items);
}

export async function listDocuments({
	filters = {},
	cursor = null,
	limit = DEFAULT_PAGE_SIZE,
	client
}: {
	filters?: DocumentFilters;
	cursor?: DocumentCursor | null;
	limit?: number;
	client?: SupabaseClient<Database>;
} = {}): Promise<DocumentPage> {
	const resolvedLimit = pageSize(limit);
	const resolvedFilters = parseDocumentFilters(filters);
	const resolvedClient = clientOrDefault(client);
	let query = resolvedClient
		.from('documents')
		.select('id,title,kind,status,page_count,thumbnail_path,notebook_id,created_at,updated_at')
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(resolvedLimit + 1);

	if (resolvedFilters.notebookId) query = query.eq('notebook_id', resolvedFilters.notebookId);
	if (resolvedFilters.kind) query = query.eq('kind', resolvedFilters.kind);
	if (resolvedFilters.status === 'ready') {
		query = query.in('status', ['ready', 'needs_review']);
	} else if (resolvedFilters.status) {
		query = query.eq('status', resolvedFilters.status);
	}
	if (resolvedFilters.createdFrom) query = query.gte('created_at', resolvedFilters.createdFrom);
	if (resolvedFilters.createdTo) query = query.lte('created_at', resolvedFilters.createdTo);
	if (cursor) {
		const value = validCursor(cursor);
		query = query.or(
			`created_at.lt.${value.createdAt},and(created_at.eq.${value.createdAt},id.lt.${value.id})`
		);
	}

	let data: unknown;
	try {
		const response = await query;
		if (response.error) throw new DocumentServiceError();
		data = response.data;
	} catch {
		const fallback = await listNativeDocumentFallback(resolvedFilters, cursor, resolvedLimit).catch(
			() => null
		);
		if (fallback) return fallback;
		throw new DocumentServiceError();
	}

	let rows: readonly DocumentRecord[];
	try {
		rows = parseDocumentRecords(data, resolvedLimit + 1);
	} catch {
		throw new DocumentServiceError();
	}
	const hasNextPage = rows.length > resolvedLimit;
	const visibleRows = hasNextPage ? rows.slice(0, resolvedLimit) : rows;
	const items = Object.freeze(visibleRows.map(mapDocumentRecord));
	const last = visibleRows.at(-1);

	return Object.freeze({
		items,
		nextCursor:
			hasNextPage && last ? Object.freeze({ createdAt: last.created_at, id: last.id }) : null
	});
}

export function listAllDocuments({
	filters = {},
	client
}: {
	filters?: DocumentFilters;
	client?: SupabaseClient<Database>;
} = {}): Promise<readonly DocumentSummary[]> {
	return collectAllDocumentPages((cursor) =>
		listDocuments({ filters, cursor, limit: MAX_PAGE_SIZE, client })
	);
}

export async function createDocument(
	input: NewDocumentInput,
	client?: SupabaseClient<Database>
): Promise<DocumentSummary> {
	const resolvedClient = clientOrDefault(client);
	const userId = await currentUserId(resolvedClient);
	try {
		const { data, error } = await resolvedClient
			.from('documents')
			.insert({
				user_id: userId,
				notebook_id: input.notebookId ?? null,
				title: input.title.trim(),
				kind: input.kind,
				original_filename: input.originalFilename,
				storage_path: input.storagePath,
				thumbnail_path: input.thumbnailPath ?? null,
				sha256: input.sha256 ?? null,
				source_created_at: input.sourceCreatedAt ?? null
			})
			.select('id,title,kind,status,page_count,thumbnail_path,notebook_id,created_at,updated_at')
			.single();

		if (error || data === null) throw new DocumentServiceError();
		return mapDocumentRecord(parseDocumentRecord(data));
	} catch {
		throw new DocumentServiceError();
	}
}

export async function updateDocument(
	documentId: string,
	input: UpdateDocumentInput,
	client?: SupabaseClient<Database>
): Promise<DocumentSummary> {
	const changes: Database['public']['Tables']['documents']['Update'] = {};
	if (input.title !== undefined) changes.title = input.title.trim();
	if (input.notebookId !== undefined) changes.notebook_id = input.notebookId;
	if (input.status !== undefined) changes.status = input.status;
	if (input.thumbnailPath !== undefined) changes.thumbnail_path = input.thumbnailPath;
	if (input.pageCount !== undefined) changes.page_count = input.pageCount;

	const validatedDocumentId = validId(documentId);
	try {
		const { data, error } = await clientOrDefault(client)
			.from('documents')
			.update(changes)
			.eq('id', validatedDocumentId)
			.select('id,title,kind,status,page_count,thumbnail_path,notebook_id,created_at,updated_at')
			.single();

		if (error || data === null) throw new DocumentServiceError();
		return mapDocumentRecord(parseDocumentRecord(data, validatedDocumentId));
	} catch {
		throw new DocumentServiceError();
	}
}

export async function deleteDocument(
	documentId: string,
	client?: SupabaseClient<Database>
): Promise<void> {
	const validatedDocumentId = validId(documentId);
	try {
		const { error } = await clientOrDefault(client).functions.invoke('delete-document', {
			body: { documentId: validatedDocumentId }
		});
		if (error) throw new DocumentServiceError();
	} catch {
		throw new DocumentServiceError();
	}
}
