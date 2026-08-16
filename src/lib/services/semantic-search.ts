import { z } from 'zod';
import { searchPages, type SearchOptions, type SearchResult } from './search';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
const SEARCH_CACHE_TTL_MS = 90_000;
const SEARCH_FALLBACK_CACHE_TTL_MS = 10_000;
const SEARCH_CACHE_MAX_ENTRIES = 40;

const resultSchema = z
	.object({
		pageId: z.string().regex(UUID),
		documentId: z.string().regex(UUID),
		documentTitle: z.string().trim().min(1).max(240),
		notebookId: z.string().regex(UUID).nullable(),
		notebookName: z.string().trim().min(1).max(120).nullable(),
		pageNumber: z.number().int().min(1).max(10_000),
		excerpt: z.string().max(2_000),
		rank: z.number().finite().nonnegative(),
		lexicalRank: z.number().finite().nonnegative(),
		semanticSimilarity: z.number().finite().min(0).max(1),
		visualSimilarity: z.number().finite().min(0).max(1).optional().default(0),
		matchMode: z.enum([
			'lexical',
			'semantic',
			'visual',
			'hybrid',
			'lexical_visual',
			'semantic_visual',
			'hybrid_visual'
		])
	})
	.strict()
	.superRefine((row, context) => {
		if ((row.notebookId === null) !== (row.notebookName === null)) {
			context.addIssue({ code: 'custom', message: 'Invalid notebook semantic search result' });
		}
	});

const indexSchema = z
	.object({
		totalPages: z.number().int().nonnegative(),
		indexedPages: z.number().int().nonnegative(),
		remainingPages: z.number().int().nonnegative(),
		coverage: z.number().finite().min(0).max(1),
		indexedThisRun: z.number().int().nonnegative().max(16).optional()
	})
	.strict()
	.superRefine((value, context) => {
		if (
			value.indexedPages > value.totalPages ||
			value.remainingPages !== value.totalPages - value.indexedPages ||
			Math.abs(
				value.coverage - (value.totalPages === 0 ? 1 : value.indexedPages / value.totalPages)
			) > 1e-9
		) {
			context.addIssue({ code: 'custom', message: 'Invalid semantic search index state' });
		}
	});

const responseSchema = z
	.object({
		mode: z.enum(['multimodal', 'hybrid', 'lexical']),
		reason: z.string().regex(REASON).nullable(),
		embeddingModel: z.string().regex(MODEL).nullable(),
		index: indexSchema.nullable(),
		queryEmbeddingCacheHit: z.boolean().optional(),
		hasMore: z.boolean(),
		results: z.array(resultSchema).max(50)
	})
	.strict();

type FunctionError = { context?: unknown; message?: string };

export type SemanticSearchResult = z.infer<typeof resultSchema>;
export type SemanticSearchIndex = Readonly<{
	totalPages: number;
	indexedPages: number;
	remainingPages: number;
	coverage: number;
	indexedThisRun: number;
	complete: boolean;
}>;
export type SemanticSearchAnalysis = Readonly<{
	mode: 'multimodal' | 'hybrid' | 'lexical';
	reason: string | null;
	embeddingModel: string | null;
	index: SemanticSearchIndex | null;
}>;
export type SemanticSearchResponse = Readonly<{
	results: readonly SemanticSearchResult[];
	hasMore: boolean;
	analysis: SemanticSearchAnalysis;
}>;

type SemanticSearchFunctionClient = {
	functions: {
		invoke(
			name: 'semantic-search',
			options: {
				body: { query: string; notebookId: string | null; limit: number; offset: number };
				signal?: AbortSignal;
			}
		): Promise<{ data: unknown; error: FunctionError | null }>;
	};
};

type CachedSearch = Readonly<{ expiresAt: number; response: SemanticSearchResponse }>;
const responseCache = new Map<string, CachedSearch>();

export class SemanticSearchServiceError extends Error {
	constructor(message = 'A busca semântica não está disponível agora.') {
		super(message);
		this.name = 'SemanticSearchServiceError';
	}
}

function defaultFunctionClient(): SemanticSearchFunctionClient {
	return getSupabaseClient() as unknown as SemanticSearchFunctionClient;
}

function lexicalResult(result: SearchResult): SemanticSearchResult {
	return Object.freeze({
		...result,
		lexicalRank: result.rank,
		semanticSimilarity: 0,
		visualSimilarity: 0,
		matchMode: 'lexical' as const
	});
}

function validateOptions(query: string, options: SearchOptions) {
	const normalized = query.trim();
	if (!normalized) return { normalized, notebookId: null, limit: 30, offset: 0 };
	if (normalized.length > 200) throw new TypeError('Invalid search query');
	const notebookId = options.notebookId ?? null;
	if (notebookId !== null && !UUID.test(notebookId)) throw new TypeError('Invalid search notebook');
	const limit = options.limit ?? 30;
	const offset = options.offset ?? 0;
	if (!Number.isInteger(limit) || limit < 1 || limit > 50)
		throw new TypeError('Invalid search limit');
	if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
		throw new TypeError('Invalid search offset');
	}
	return { normalized, notebookId, limit, offset };
}

function parseResponse(value: unknown): SemanticSearchResponse {
	let parsed: z.infer<typeof responseSchema>;
	try {
		parsed = responseSchema.parse(value);
	} catch {
		throw new SemanticSearchServiceError('O serviço de busca devolveu uma resposta inválida.');
	}
	if (
		(parsed.mode === 'hybrid' || parsed.mode === 'multimodal') &&
		parsed.embeddingModel === null
	) {
		throw new SemanticSearchServiceError('O serviço de busca devolveu um modo semântico inválido.');
	}
	return Object.freeze({
		results: Object.freeze(parsed.results.map((result) => Object.freeze(result))),
		hasMore: parsed.hasMore,
		analysis: Object.freeze({
			mode: parsed.mode,
			reason: parsed.reason,
			embeddingModel: parsed.embeddingModel,
			index: parsed.index
				? Object.freeze({
						totalPages: parsed.index.totalPages,
						indexedPages: parsed.index.indexedPages,
						remainingPages: parsed.index.remainingPages,
						coverage: parsed.index.coverage,
						indexedThisRun: parsed.index.indexedThisRun ?? 0,
						complete: parsed.index.remainingPages === 0
					})
				: null
		})
	});
}

async function lexicalFallback(
	query: string,
	options: SearchOptions,
	reason: string
): Promise<SemanticSearchResponse> {
	const results = await searchPages(query, options);
	return Object.freeze({
		results: Object.freeze(results.map(lexicalResult)),
		hasMore: results.length === (options.limit ?? 30),
		analysis: Object.freeze({ mode: 'lexical', reason, embeddingModel: null, index: null })
	});
}

function searchCacheKey(
	userId: string,
	input: { normalized: string; notebookId: string | null; limit: number; offset: number }
) {
	return JSON.stringify([userId, input.normalized, input.notebookId, input.limit, input.offset]);
}

async function currentCacheUserId() {
	try {
		const { data, error } = await getSupabaseClient().auth.getSession();
		const userId = data.session?.user.id;
		return !error && typeof userId === 'string' && UUID.test(userId) ? userId : null;
	} catch {
		return null;
	}
}

function cachedSearch(key: string) {
	const cached = responseCache.get(key);
	if (!cached) return null;
	if (cached.expiresAt <= Date.now()) {
		responseCache.delete(key);
		return null;
	}
	responseCache.delete(key);
	responseCache.set(key, cached);
	return cached.response;
}

function cacheSearch(key: string, response: SemanticSearchResponse) {
	const transientFallback =
		response.analysis.mode === 'lexical' &&
		(response.analysis.reason?.includes('unavailable') === true ||
			response.analysis.reason === 'semantic_quota_or_rate_limit' ||
			response.analysis.reason === 'semantic_rpc_unavailable');
	responseCache.set(
		key,
		Object.freeze({
			expiresAt:
				Date.now() + (transientFallback ? SEARCH_FALLBACK_CACHE_TTL_MS : SEARCH_CACHE_TTL_MS),
			response
		})
	);
	while (responseCache.size > SEARCH_CACHE_MAX_ENTRIES) {
		const oldest = responseCache.keys().next().value;
		if (typeof oldest !== 'string') break;
		responseCache.delete(oldest);
	}
}

export function clearSemanticSearchCache() {
	responseCache.clear();
}

export async function searchPagesHybrid(
	query: string,
	options: SearchOptions = {},
	client?: SemanticSearchFunctionClient
): Promise<SemanticSearchResponse> {
	const validated = validateOptions(query, options);
	if (!validated.normalized) {
		return Object.freeze({
			results: Object.freeze([]),
			hasMore: false,
			analysis: Object.freeze({
				mode: 'lexical',
				reason: 'blank_query',
				embeddingModel: null,
				index: null
			})
		});
	}
	if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');

	const useCache = client === undefined;
	const userId = useCache ? await currentCacheUserId() : null;
	if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
	const cacheKey = userId ? searchCacheKey(userId, validated) : null;
	if (cacheKey) {
		const cached = cachedSearch(cacheKey);
		if (cached) return cached;
	}

	try {
		const gateway = client ?? defaultFunctionClient();
		const { data, error } = await gateway.functions.invoke('semantic-search', {
			body: {
				query: validated.normalized,
				notebookId: validated.notebookId,
				limit: validated.limit,
				offset: validated.offset
			},
			signal: options.signal
		});
		if (error) {
			if (options.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
			const fallback = await lexicalFallback(
				validated.normalized,
				options,
				'semantic_function_unavailable'
			);
			if (cacheKey) cacheSearch(cacheKey, fallback);
			return fallback;
		}
		const response = parseResponse(data);
		if (cacheKey) cacheSearch(cacheKey, response);
		return response;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (error instanceof SemanticSearchServiceError) throw error;
		try {
			const fallback = await lexicalFallback(
				validated.normalized,
				options,
				'semantic_function_unavailable'
			);
			if (cacheKey) cacheSearch(cacheKey, fallback);
			return fallback;
		} catch {
			throw new SemanticSearchServiceError('Não foi possível pesquisar o fichário agora.');
		}
	}
}
