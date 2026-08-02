import type { SupabaseClient } from '@supabase/supabase-js';
import {
	mapDocumentRecord,
	type DocumentCursor,
	type DocumentFilters,
	type DocumentPage,
	type DocumentRecord,
	type DocumentSummary,
	type NewDocumentInput,
	type UpdateDocumentInput
} from '$lib/domain/document';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
	if (!UUID.test(cursor.id) || Number.isNaN(Date.parse(cursor.createdAt))) {
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

async function currentUserId(client: SupabaseClient<Database>): Promise<string> {
	const { data, error } = await client.auth.getSession();
	if (error || data.session === null) throw new DocumentServiceError();
	return data.session.user.id;
}

export type DocumentPageLoader = (cursor: DocumentCursor | null) => Promise<DocumentPage>;

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
	const resolvedClient = clientOrDefault(client);
	const resolvedLimit = pageSize(limit);
	let query = resolvedClient
		.from('documents')
		.select(
			'id,title,kind,status,page_count,thumbnail_path,notebook_id,created_at,updated_at'
		)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(resolvedLimit + 1);

	if (filters.notebookId) query = query.eq('notebook_id', validId(filters.notebookId));
	if (filters.kind) query = query.eq('kind', filters.kind);
	if (filters.status) query = query.eq('status', filters.status);
	if (filters.createdFrom) query = query.gte('created_at', filters.createdFrom);
	if (filters.createdTo) query = query.lte('created_at', filters.createdTo);
	if (cursor) {
		const value = validCursor(cursor);
		query = query.or(
			`created_at.lt.${value.createdAt},and(created_at.eq.${value.createdAt},id.lt.${value.id})`
		);
	}

	const { data, error } = await query;
	if (error || !Array.isArray(data)) throw new DocumentServiceError();

	const rows = data as unknown as DocumentRecord[];
	const hasNextPage = rows.length > resolvedLimit;
	const visibleRows = hasNextPage ? rows.slice(0, resolvedLimit) : rows;
	const items = Object.freeze(visibleRows.map(mapDocumentRecord));
	const last = visibleRows.at(-1);

	return Object.freeze({
		items,
		nextCursor:
			hasNextPage && last
				? Object.freeze({ createdAt: last.created_at, id: last.id })
				: null
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
	return mapDocumentRecord(data as unknown as DocumentRecord);
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

	const { data, error } = await clientOrDefault(client)
		.from('documents')
		.update(changes)
		.eq('id', validId(documentId))
		.select('id,title,kind,status,page_count,thumbnail_path,notebook_id,created_at,updated_at')
		.single();

	if (error || data === null) throw new DocumentServiceError();
	return mapDocumentRecord(data as unknown as DocumentRecord);
}

export async function deleteDocument(
	documentId: string,
	client?: SupabaseClient<Database>
): Promise<void> {
	const { error } = await clientOrDefault(client).functions.invoke('delete-document', {
		body: { documentId: validId(documentId) }
	});
	if (error) throw new DocumentServiceError();
}
