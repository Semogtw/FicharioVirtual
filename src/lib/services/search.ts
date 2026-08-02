import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

type SearchRow = {
	page_id: string;
	document_id: string;
	document_title: string;
	notebook_id: string | null;
	notebook_name: string | null;
	page_number: number;
	excerpt: string;
	rank: number;
};

type SearchQueryLike = PromiseLike<{ data: unknown; error: unknown }> & {
	abortSignal(signal: AbortSignal): SearchQueryLike;
};

export type SearchClientLike = {
	rpc(
		name: 'search_pages',
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

export async function searchPages(
	query: string,
	options: SearchOptions = {},
	client: SearchClientLike = defaultClient()
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

	let request = client.rpc('search_pages', {
		search_query: normalized,
		notebook_filter: notebookId,
		result_limit: limit,
		result_offset: offset
	});
	if (options.signal) request = request.abortSignal(options.signal);
	const { data, error } = await request;
	if (error || !Array.isArray(data)) throw new SearchServiceError();
	return Object.freeze((data as SearchRow[]).map(mapRow));
}
