import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { GeminiEmbeddingHttpError } from '../_shared/gemini-embedding-client.ts';
import {
	SEMANTIC_CONSENT_VERSION,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_SEARCH_MIN_SIMILARITY
} from '../_shared/semantic-config.ts';
import { indexNextSemanticBatch, semanticIndexStats } from '../_shared/semantic-indexer.ts';
import { getSemanticQueryEmbedding } from '../_shared/semantic-query-cache.ts';
import {
	compareHybridRanked,
	hybridReciprocalRankScore
} from '../_shared/semantic-ranking.ts';
import { recordSemanticRetrievalEvent } from '../_shared/semantic-retrieval-telemetry.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_QUERY_CHARS = 200;
const MAX_RESULT_LIMIT = 50;
const MAX_OFFSET = 10_000;
const MAX_HYBRID_WINDOW = 100;
const MIN_SEMANTIC_QUERY_CHARS = 3;

type ParsedRequest = Readonly<{
	query: string;
	notebookId: string | null;
	limit: number;
	offset: number;
}>;

type LexicalRow = {
	page_id: string;
	document_id: string;
	document_title: string;
	notebook_id: string | null;
	notebook_name: string | null;
	page_number: number;
	excerpt: string;
	rank: number;
};

type SemanticRow = Omit<LexicalRow, 'rank'> & { semantic_similarity: number };

type SearchCandidate = {
	pageId: string;
	documentId: string;
	documentTitle: string;
	notebookId: string | null;
	notebookName: string | null;
	pageNumber: number;
	excerpt: string;
	lexicalRank: number;
	semanticSimilarity: number;
	lexicalPosition: number | null;
	semanticPosition: number | null;
	score: number;
	matchMode: 'lexical' | 'semantic' | 'hybrid';
	stableKey: string;
};

function json(status: number, body: Record<string, unknown>, appOrigin: string | null) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(appOrigin),
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
}

function empty(status: number, appOrigin: string | null) {
	return new Response(null, {
		status,
		headers: { ...corsHeaders(appOrigin), 'Cache-Control': 'no-store' }
	});
}

function parseRequest(value: unknown): ParsedRequest | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const allowed = new Set(['query', 'notebookId', 'limit', 'offset']);
	if (Object.keys(record).some((key) => !allowed.has(key))) return null;
	if (typeof record.query !== 'string') return null;
	const query = record.query.trim();
	if (query.length < 1 || query.length > MAX_QUERY_CHARS) return null;
	const notebookId = record.notebookId ?? null;
	if (notebookId !== null && (typeof notebookId !== 'string' || !UUID.test(notebookId))) return null;
	const limit = record.limit ?? 30;
	const offset = record.offset ?? 0;
	if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_RESULT_LIMIT) return null;
	if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > MAX_OFFSET) return null;
	return {
		query,
		notebookId: notebookId as string | null,
		limit: Number(limit),
		offset: Number(offset)
	};
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function validLexicalRow(value: unknown): value is LexicalRow {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.page_id === 'string' && UUID.test(row.page_id) &&
		typeof row.document_id === 'string' && UUID.test(row.document_id) &&
		typeof row.document_title === 'string' && row.document_title.trim().length > 0 &&
		(row.notebook_id === null || (typeof row.notebook_id === 'string' && UUID.test(row.notebook_id))) &&
		(row.notebook_name === null || typeof row.notebook_name === 'string') &&
		(row.notebook_id === null) === (row.notebook_name === null) &&
		Number.isInteger(row.page_number) && Number(row.page_number) >= 1 &&
		typeof row.excerpt === 'string' &&
		typeof row.rank === 'number' && Number.isFinite(row.rank) && row.rank >= 0
	);
}

function validSemanticRow(value: unknown): value is SemanticRow {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		validLexicalRow({ ...row, rank: 0 }) &&
		typeof row.semantic_similarity === 'number' &&
		Number.isFinite(row.semantic_similarity) &&
		row.semantic_similarity >= 0 && row.semantic_similarity <= 1
	);
}

async function lexicalRows(
	supabase: ReturnType<typeof createClient>,
	input: ParsedRequest,
	limit: number,
	offset: number
) {
	const { data, error } = await supabase.rpc('search_pages', {
		search_query: input.query,
		notebook_filter: input.notebookId,
		result_limit: limit,
		result_offset: offset
	});
	if (error) throw error;
	return Array.isArray(data) ? data.filter(validLexicalRow) : [];
}

function candidateKey(input: { documentId: string; pageNumber: number }) {
	return `${input.documentId}:${String(input.pageNumber).padStart(8, '0')}`;
}

function publicCandidate(candidate: SearchCandidate) {
	return {
		pageId: candidate.pageId,
		documentId: candidate.documentId,
		documentTitle: candidate.documentTitle,
		notebookId: candidate.notebookId,
		notebookName: candidate.notebookName,
		pageNumber: candidate.pageNumber,
		excerpt: candidate.excerpt,
		rank: candidate.score,
		lexicalRank: candidate.lexicalRank,
		semanticSimilarity: candidate.semanticSimilarity,
		matchMode: candidate.matchMode
	};
}

function mergeCandidates(lexical: readonly LexicalRow[], semantic: readonly SemanticRow[]) {
	const merged = new Map<string, SearchCandidate>();
	lexical.forEach((row, index) => {
		const candidate: SearchCandidate = {
			pageId: row.page_id,
			documentId: row.document_id,
			documentTitle: row.document_title,
			notebookId: row.notebook_id,
			notebookName: row.notebook_name,
			pageNumber: row.page_number,
			excerpt: row.excerpt.slice(0, 2000),
			lexicalRank: row.rank,
			semanticSimilarity: 0,
			lexicalPosition: index + 1,
			semanticPosition: null,
			score: 0,
			matchMode: 'lexical',
			stableKey: candidateKey({ documentId: row.document_id, pageNumber: row.page_number })
		};
		candidate.score = hybridReciprocalRankScore({
			lexicalRank: candidate.lexicalPosition,
			semanticRank: null,
			semanticSimilarity: null
		});
		merged.set(row.page_id, candidate);
	});

	semantic.forEach((row, index) => {
		if (row.semantic_similarity < SEMANTIC_SEARCH_MIN_SIMILARITY) return;
		const current = merged.get(row.page_id);
		if (current) {
			current.semanticPosition = index + 1;
			current.semanticSimilarity = row.semantic_similarity;
			current.matchMode = 'hybrid';
			if (row.semantic_similarity >= 0.62 && row.excerpt.trim()) current.excerpt = row.excerpt.slice(0, 2000);
			current.score = hybridReciprocalRankScore({
				lexicalRank: current.lexicalPosition,
				semanticRank: current.semanticPosition,
				semanticSimilarity: current.semanticSimilarity
			});
			return;
		}
		const candidate: SearchCandidate = {
			pageId: row.page_id,
			documentId: row.document_id,
			documentTitle: row.document_title,
			notebookId: row.notebook_id,
			notebookName: row.notebook_name,
			pageNumber: row.page_number,
			excerpt: row.excerpt.slice(0, 2000),
			lexicalRank: 0,
			semanticSimilarity: row.semantic_similarity,
			lexicalPosition: null,
			semanticPosition: index + 1,
			score: 0,
			matchMode: 'semantic',
			stableKey: candidateKey({ documentId: row.document_id, pageNumber: row.page_number })
		};
		candidate.score = hybridReciprocalRankScore({
			lexicalRank: null,
			semanticRank: candidate.semanticPosition,
			semanticSimilarity: candidate.semanticSimilarity
		});
		merged.set(row.page_id, candidate);
	});

	return [...merged.values()].sort((left, right) => compareHybridRanked(
		{
			lexicalRank: left.lexicalPosition,
			semanticRank: left.semanticPosition,
			semanticSimilarity: left.semanticSimilarity,
			stableKey: left.stableKey
		},
		{
			lexicalRank: right.lexicalPosition,
			semanticRank: right.semanticPosition,
			semanticSimilarity: right.semanticSimilarity,
			stableKey: right.stableKey
		}
	));
}

async function fallbackResponse(input: {
	supabase: ReturnType<typeof createClient>;
	parsed: ParsedRequest;
	reason: string;
	startedAt: number;
	embeddingModel?: string | null;
	index?: Awaited<ReturnType<typeof semanticIndexStats>> | null;
}) {
	const rows = await lexicalRows(input.supabase, input.parsed, input.parsed.limit, input.parsed.offset);
	await recordSemanticRetrievalEvent(input.supabase, {
		surface: 'global_search',
		mode: 'fallback',
		model: input.embeddingModel ?? null,
		resultCount: rows.length,
		lexicalOnlyCount: rows.length,
		totalPages: input.index?.totalPages ?? null,
		indexedPages: input.index?.indexedPages ?? null,
		durationMs: performance.now() - input.startedAt,
		queryEmbeddingCacheHit: null,
		fallbackReason: input.reason
	});
	return {
		mode: 'lexical',
		reason: input.reason,
		embeddingModel: input.embeddingModel ?? null,
		index: input.index ?? null,
		hasMore: rows.length === input.parsed.limit,
		results: rows.map((row, position) => {
			const score = hybridReciprocalRankScore({
				lexicalRank: position + 1,
				semanticRank: null,
				semanticSimilarity: null
			});
			return publicCandidate({
				pageId: row.page_id,
				documentId: row.document_id,
				documentTitle: row.document_title,
				notebookId: row.notebook_id,
				notebookName: row.notebook_name,
				pageNumber: row.page_number,
				excerpt: row.excerpt.slice(0, 2000),
				lexicalRank: row.rank,
				semanticSimilarity: 0,
				lexicalPosition: position + 1,
				semanticPosition: null,
				score,
				matchMode: 'lexical',
				stableKey: candidateKey({ documentId: row.document_id, pageNumber: row.page_number })
			});
		})
	};
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);
	if (!appOrigin) return respond(503, { code: 'search_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) return respond(401, { code: 'authentication_required' });

	let raw: unknown;
	try {
		raw = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
	} catch (error) {
		return error instanceof RequestBodyTooLargeError
			? respond(413, { code: 'search_request_too_large' })
			: respond(400, { code: 'invalid_json' });
	}
	const parsed = parseRequest(raw);
	if (!parsed) return respond(400, { code: 'invalid_search_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!supabaseUrl || !publishableKey) return respond(503, { code: 'search_not_configured' });
	const supabase = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user) return respond(401, { code: 'authentication_required' });

	const startedAt = performance.now();
	const abort = new AbortController();
	const timeout = setTimeout(
		() => abort.abort(),
		envInteger('SEMANTIC_SEARCH_TIMEOUT_MS', 30_000, 5_000, 90_000)
	);

	try {
		const apiKey = Deno.env.get('GEMINI_API_KEY');
		const { data: consent, error: consentError } = await supabase.rpc('has_search_semantic_consent', {
			consent_version: SEMANTIC_CONSENT_VERSION
		});
		const semanticAllowed =
			parsed.query.length >= MIN_SEMANTIC_QUERY_CHARS &&
			!consentError &&
			consent === true &&
			Boolean(apiKey) &&
			parsed.offset + parsed.limit <= MAX_HYBRID_WINDOW;

		if (!semanticAllowed) {
			let reason = 'semantic_not_configured';
			if (parsed.query.length < MIN_SEMANTIC_QUERY_CHARS) reason = 'query_too_short';
			else if (!consentError && consent !== true) reason = 'consent_required';
			else if (parsed.offset + parsed.limit > MAX_HYBRID_WINDOW) reason = 'semantic_window_exhausted';
			return respond(200, await fallbackResponse({ supabase, parsed, reason, startedAt }));
		}

		let indexedThisRun = 0;
		try {
			const indexBatch = await indexNextSemanticBatch({
				supabase,
				apiKey: apiKey!,
				notebookId: parsed.notebookId,
				batchPages: envInteger('SEMANTIC_SEARCH_INDEX_BATCH_PAGES', 4, 1, 12),
				concurrency: 2,
				surface: 'search',
				signal: abort.signal
			});
			indexedThisRun = indexBatch.indexedPages;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
		}

		let queryEmbedding: Awaited<ReturnType<typeof getSemanticQueryEmbedding>>;
		try {
			queryEmbedding = await getSemanticQueryEmbedding({
				supabase,
				apiKey: apiKey!,
				query: parsed.query,
				surface: 'search',
				signal: abort.signal
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			const index = await semanticIndexStats(supabase, parsed.notebookId).catch(() => null);
			return respond(200, await fallbackResponse({
				supabase,
				parsed,
				reason: error instanceof GeminiEmbeddingHttpError && error.status === 429
					? 'semantic_quota_or_rate_limit'
					: 'semantic_provider_unavailable',
				startedAt,
				embeddingModel: SEMANTIC_EMBEDDING_MODEL,
				index
			}));
		}

		const candidateLimit = Math.min(
			MAX_HYBRID_WINDOW,
			Math.max(parsed.offset + parsed.limit + 20, parsed.limit * 2)
		);
		const [lexical, semanticResponse] = await Promise.all([
			lexicalRows(supabase, parsed, candidateLimit, 0),
			supabase.rpc('search_pages_semantic', {
				query_embedding: queryEmbedding.vectorText,
				target_model: SEMANTIC_EMBEDDING_MODEL,
				notebook_filter: parsed.notebookId,
				result_limit: Math.min(50, candidateLimit)
			})
		]);
		if (semanticResponse.error) {
			const index = await semanticIndexStats(supabase, parsed.notebookId).catch(() => null);
			return respond(200, await fallbackResponse({
				supabase,
				parsed,
				reason: 'semantic_rpc_unavailable',
				startedAt,
				embeddingModel: SEMANTIC_EMBEDDING_MODEL,
				index
			}));
		}

		const semantic = Array.isArray(semanticResponse.data)
			? semanticResponse.data.filter(validSemanticRow)
			: [];
		const ranked = mergeCandidates(lexical, semantic);
		const end = parsed.offset + parsed.limit;
		const results = ranked.slice(parsed.offset, end).map(publicCandidate);
		const index = await semanticIndexStats(supabase, parsed.notebookId).catch(() => null);
		const lexicalOnlyCount = ranked.filter((item) => item.matchMode === 'lexical').length;
		const semanticOnlyCount = ranked.filter((item) => item.matchMode === 'semantic').length;
		const hybridCount = ranked.filter((item) => item.matchMode === 'hybrid').length;
		await recordSemanticRetrievalEvent(supabase, {
			surface: 'global_search',
			mode: semanticOnlyCount > 0 || hybridCount > 0 ? 'hybrid' : 'lexical',
			model: SEMANTIC_EMBEDDING_MODEL,
			resultCount: results.length,
			lexicalOnlyCount,
			semanticOnlyCount,
			hybridCount,
			totalPages: index?.totalPages ?? null,
			indexedPages: index?.indexedPages ?? null,
			durationMs: performance.now() - startedAt,
			queryEmbeddingCacheHit: queryEmbedding.cacheHit
		});

		return respond(200, {
			mode: 'hybrid',
			reason: null,
			embeddingModel: SEMANTIC_EMBEDDING_MODEL,
			index: index ? { ...index, indexedThisRun } : null,
			queryEmbeddingCacheHit: queryEmbedding.cacheHit,
			hasMore: ranked.length > end || lexical.length === candidateLimit,
			results
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			return respond(504, { code: 'search_timeout' });
		}
		return respond(503, { code: 'search_unavailable' });
	} finally {
		clearTimeout(timeout);
	}
});