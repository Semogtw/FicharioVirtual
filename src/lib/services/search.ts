import { z } from 'zod';
import {
	listNativeDocumentPages,
	listNativeDocumentsPage,
	type NativeDocument,
	type NativeDocumentPageCursor
} from '$lib/native/local-document-store';
import { isNativeRuntime } from '$lib/platform/native-bridge';
import { sessionState } from '$lib/stores/session.svelte';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const searchRowSchema = z
	.object({
		page_id: z.string().regex(UUID),
		document_id: z.string().regex(UUID),
		document_title: z.string().trim().min(1).max(240),
		notebook_id: z.string().regex(UUID).nullable(),
		notebook_name: z.string().trim().min(1).max(120).nullable(),
		page_number: z.number().int().min(1).max(10_000),
		excerpt: z.string().max(2_000),
		rank: z.number().finite().nonnegative()
	})
	.strict()
	.superRefine((row, context) => {
		if ((row.notebook_id === null) !== (row.notebook_name === null)) {
			context.addIssue({ code: 'custom', message: 'Invalid notebook search result' });
		}
	});
const searchRowsSchema = z.array(searchRowSchema).max(100);

type SearchRow = z.infer<typeof searchRowSchema>;

export type SearchResult = {
	pageId: string;
	documentId: string;
	documentTitle: string;
	notebookId: string | null;
	notebookName: string | null;
	pageNumber: number;
	excerpt: string;
	rank: number;
};

type SearchQueryLike = PromiseLike<{ data: unknown; error: unknown }> & {
	abortSignal(signal: AbortSignal): SearchQueryLike;
};

export type SearchClientLike = {
	rpc(
		name: 'search_documents',
		args: {
			search_query: string;
			notebook_filter: string | null;
			result_limit: number;
			result_offset: number;
		}
	): SearchQueryLike;
};

export type SearchOptions = {
	notebookId?: string | null;
	limit?: number;
	offset?: number;
	signal?: AbortSignal;
};

export class SearchServiceError extends Error {
	constructor() {
		super('Não foi possível pesquisar o fichário agora.');
		this.name = 'SearchServiceError';
	}
}

function defaultClient(): SearchClientLike {
	return getSupabaseClient() as unknown as SearchClientLike;
}

function positiveInteger(value: number, maximum: number, label: string) {
	if (!Number.isInteger(value) || value < 0 || value > maximum) {
		throw new TypeError(`Invalid search ${label}`);
	}
	return value;
}

function mapRow(row: SearchRow): SearchResult {
	return Object.freeze({
		pageId: row.page_id,
		documentId: row.document_id,
		documentTitle: row.document_title,
		notebookId: row.notebook_id,
		notebookName: row.notebook_name,
		pageNumber: row.page_number,
		excerpt: row.excerpt,
		rank: row.rank
	});
}

function nativeExcerpt(text: string, query: string) {
	const lowerText = text.toLocaleLowerCase();
	const lowerQuery = query.toLocaleLowerCase();
	const index = Math.max(
		lowerText.indexOf(lowerQuery),
		...query
			.split(/\s+/u)
			.filter(Boolean)
			.map((term) => lowerText.indexOf(term.toLocaleLowerCase()))
	);
	const matchIndex = index < 0 ? 0 : index;
	const start = Math.max(0, matchIndex - 160);
	const end = Math.min(text.length, start + 2_000);
	const excerpt = text.slice(start, end).trim();
	return `${start > 0 ? '…' : ''}${excerpt}${end < text.length ? '…' : ''}`;
}

function nativeDocumentTitle(document: NativeDocument) {
	const title = document.title?.trim();
	if (title) return title.slice(0, 240);
	return document.originalFilename.replace(/\.[^.]+$/u, '').trim() || 'Documento local';
}

async function listAllNativeDocuments(ownerId: string): Promise<readonly NativeDocument[]> {
	const documents: NativeDocument[] = [];
	const seenCursors = new Set<string>();
	let cursor: NativeDocumentPageCursor | null = null;
	while (true) {
		const page = await listNativeDocumentsPage({ limit: 1_000, cursor });
		if (!page) return Object.freeze([]);
		documents.push(...page.documents.filter((document) => document.ownerId === ownerId));
		if (!page.nextCursor) return Object.freeze(documents);
		const key = `${page.nextCursor.lastAccessedAtMs}:${page.nextCursor.documentId}`;
		if (seenCursors.has(key)) throw new SearchServiceError();
		seenCursors.add(key);
		cursor = page.nextCursor;
	}
}

async function searchNativePages(
	query: string,
	options: SearchOptions,
	limit: number,
	offset: number
): Promise<readonly SearchResult[] | null> {
	if (!isNativeRuntime()) return null;
	const ownerId = sessionState.user?.id;
	if (!ownerId) return null;
	const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
	const documents = await listAllNativeDocuments(ownerId);
	const matches: SearchResult[] = [];
	for (const document of documents) {
		if (options.notebookId && document.notebookId !== options.notebookId) continue;
		const pages = await listNativeDocumentPages(document.documentId, ownerId);
		for (const page of pages ?? []) {
			if (page.documentId !== document.documentId) continue;
			const text = page.nativeText?.trim();
			if (!text) continue;
			const lowerText = text.toLocaleLowerCase();
			if (!terms.every((term) => lowerText.includes(term))) continue;
			const firstMatch = Math.max(0, ...terms.map((term) => lowerText.indexOf(term)));
			matches.push({
				pageId: `${document.documentId}:native:${page.pageNumber}`,
				documentId: document.documentId,
				documentTitle: nativeDocumentTitle(document),
				notebookId: document.notebookId ?? null,
				notebookName: null,
				pageNumber: page.pageNumber,
				excerpt: nativeExcerpt(text, query),
				rank: 1 / (1 + firstMatch)
			});
		}
	}
	matches.sort(
		(left, right) =>
			right.rank - left.rank ||
			left.documentId.localeCompare(right.documentId) ||
			left.pageNumber - right.pageNumber
	);
	return Object.freeze(matches.slice(offset, offset + limit));
}

export async function searchPages(
	query: string,
	options: SearchOptions = {},
	client?: SearchClientLike
): Promise<readonly SearchResult[]> {
	const normalized = query.trim();
	if (normalized.length === 0) return Object.freeze([]);
	if (normalized.length > 200) throw new TypeError('Invalid search query');
	const limit = options.limit ?? 30;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new TypeError('Invalid search limit');
	}
	const offset = positiveInteger(options.offset ?? 0, 10_000, 'offset');
	const notebookId = options.notebookId ?? null;
	if (notebookId !== null && !UUID.test(notebookId)) {
		throw new TypeError('Invalid search notebook');
	}
	if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
	if (
		!client &&
		isNativeRuntime() &&
		typeof navigator !== 'undefined' &&
		navigator.onLine === false
	) {
		const nativeResults = await searchNativePages(normalized, options, limit, offset).catch(
			() => null
		);
		if (nativeResults) return nativeResults;
	}

	try {
		const gateway = client ?? defaultClient();
		let request = gateway.rpc('search_documents', {
			search_query: normalized,
			notebook_filter: notebookId,
			result_limit: limit,
			result_offset: offset
		});
		if (options.signal) request = request.abortSignal(options.signal);
		const { data, error } = await request;
		if (error) throw new SearchServiceError();
		return Object.freeze(searchRowsSchema.parse(data).map(mapRow));
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (!client) {
			const nativeResults = await searchNativePages(normalized, options, limit, offset).catch(
				() => null
			);
			if (nativeResults) return nativeResults;
		}
		throw new SearchServiceError();
	}
}
