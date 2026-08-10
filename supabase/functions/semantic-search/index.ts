import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import {
	embeddingVectorText,
	GeminiEmbeddingHttpError
} from '../_shared/gemini-embedding-client.ts';
import { requestGeminiEmbeddingsWithTelemetry } from '../_shared/semantic-provider-telemetry.ts';
import { chunkSemanticText } from '../_shared/semantic-chunks.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_QUERY_CHARS = 200;
const MAX_RESULT_LIMIT = 50;
const MAX_OFFSET = 10_000;
const MAX_HYBRID_WINDOW = 100;
const MAX_INDEX_CHUNKS_PER_RUN = 48;
const EMBEDDING_DIMENSIONS = 768;
const CONSENT_VERSION = 1;
const MIN_SEMANTIC_QUERY_CHARS = 3;
const MIN_SEMANTIC_SIMILARITY = 0.48;

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

type IndexPage = {
	page_id: string;
	document_id: string;
	document_title: string;
	page_number: number;
	source_text: string;
	source_hash: string;
};

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
	score: number;
	matchMode: 'lexical' | 'semantic' | 'hybrid';
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
	if (notebookId !== null && (typeof notebookId !== 'string' || !UUID.test(notebookId)))
		return null;
	const limit = record.limit ?? 30;
	const offset = record.offset ?? 0;
	if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_RESULT_LIMIT)
		return null;
	if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > MAX_OFFSET) return null;
	return Object.freeze({
		query,
		notebookId: notebookId as string | null,
		limit: limit as number,
		offset: offset as number
	});
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function validLexicalRow(value: unknown): value is LexicalRow {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.page_id === 'string' &&
		UUID.test(row.page_id) &&
		typeof row.document_id === 'string' &&
		UUID.test(row.document_id) &&
		typeof row.document_title === 'string' &&
		row.document_title.trim().length > 0 &&
		(row.notebook_id === null ||
			(typeof row.notebook_id === 'string' && UUID.test(row.notebook_id))) &&
		(row.notebook_name === null || typeof row.notebook_name === 'string') &&
		(row.notebook_id === null) === (row.notebook_name === null) &&
		Number.isInteger(row.page_number) &&
		Number(row.page_number) >= 1 &&
		typeof row.excerpt === 'string' &&
		typeof row.rank === 'number' &&
		Number.isFinite(row.rank) &&
		row.rank >= 0
	);
}

function validSemanticRow(value: unknown): value is SemanticRow {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		validLexicalRow({ ...row, rank: 0 }) &&
		typeof row.semantic_similarity === 'number' &&
		Number.isFinite(row.semantic_similarity) &&
		row.semantic_similarity >= 0 &&
		row.semantic_similarity <= 1
	);
}

function parseIndexPages(value: unknown): readonly IndexPage[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	const pages: IndexPage[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
		const row = raw as Record<string, unknown>;
		if (
			typeof row.page_id !== 'string' ||
			!UUID.test(row.page_id) ||
			typeof row.document_id !== 'string' ||
			!UUID.test(row.document_id) ||
			typeof row.document_title !== 'string' ||
			!Number.isInteger(row.page_number) ||
			typeof row.source_text !== 'string' ||
			row.source_text.trim().length < 1 ||
			typeof row.source_hash !== 'string' ||
			!HASH.test(row.source_hash)
		)
			continue;
		pages.push(row as IndexPage);
	}
	return Object.freeze(pages);
}

async function indexPages(input: {
	supabase: ReturnType<typeof createClient>;
	apiKey: string;
	model: string;
	notebookId: string | null;
	pageBudget: number;
	signal: AbortSignal;
}) {
	const { data, error } = await input.supabase.rpc('list_pages_needing_semantic_index', {
		target_model: input.model,
		notebook_filter: input.notebookId,
		result_limit: input.pageBudget
	});
	if (error) throw error;
	const pages = parseIndexPages(data);
	const flattened: Array<{ page: IndexPage; chunkIndex: number; chunkText: string }> = [];
	for (const page of pages) {
		const chunks = chunkSemanticText(page.source_text);
		if (chunks.length === 0) continue;
		if (flattened.length + chunks.length > MAX_INDEX_CHUNKS_PER_RUN) break;
		for (const chunk of chunks) {
			flattened.push({ page, chunkIndex: chunk.index, chunkText: chunk.text });
		}
	}
	if (flattened.length === 0) return 0;

	const vectors = await requestGeminiEmbeddingsWithTelemetry({
		supabase: input.supabase,
		apiKey: input.apiKey,
		model: input.model,
		inputs: flattened.map((item) => ({
			text: item.chunkText,
			title: `${item.page.document_title} — página ${item.page.page_number}`
		})),
		taskType: 'RETRIEVAL_DOCUMENT',
		outputDimensionality: EMBEDDING_DIMENSIONS,
		operation: 'document_embedding',
		surface: 'search',
		signal: input.signal
	});

	const grouped = new Map<string, { page: IndexPage; chunks: Array<Record<string, unknown>> }>();
	flattened.forEach((item, index) => {
		let group = grouped.get(item.page.page_id);
		if (!group) {
			group = { page: item.page, chunks: [] };
			grouped.set(item.page.page_id, group);
		}
		group.chunks.push({
			chunk_index: item.chunkIndex,
			chunk_text: item.chunkText,
			embedding_text: embeddingVectorText(vectors[index]!)
		});
	});

	let storedPages = 0;
	for (const group of grouped.values()) {
		const { data: stored, error: storeError } = await input.supabase.rpc(
			'replace_page_semantic_chunks',
			{
				target_page_id: group.page.page_id,
				target_model: input.model,
				target_source_hash: group.page.source_hash,
				chunk_payload: group.chunks
			}
		);
		if (!storeError && typeof stored === 'number' && stored > 0) storedPages += 1;
	}
	return storedPages;
}

async function indexStats(
	supabase: ReturnType<typeof createClient>,
	model: string,
	notebookId: string | null
) {
	const { data, error } = await supabase.rpc('semantic_index_stats', {
		target_model: model,
		notebook_filter: notebookId
	});
	if (error || !Array.isArray(data) || !data[0]) return null;
	const row = data[0] as Record<string, unknown>;
	const total = Number(row.total_pages);
	const indexed = Number(row.indexed_pages);
	if (
		!Number.isSafeInteger(total) ||
		total < 0 ||
		!Number.isSafeInteger(indexed) ||
		indexed < 0 ||
		indexed > total
	) {
		return null;
	}
	return Object.freeze({ totalPages: total, indexedPages: indexed, complete: indexed === total });
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

function clamp(value: number) {
	return Math.min(1, Math.max(0, value));
}

function lexicalSignal(rank: number) {
	return clamp(rank / 0.9);
}

function semanticSignal(similarity: number) {
	return clamp((similarity - 0.45) / 0.35);
}

function scoreCandidate(candidate: Pick<SearchCandidate, 'lexicalRank' | 'semanticSimilarity'>) {
	const lexical = lexicalSignal(candidate.lexicalRank);
	const semantic = semanticSignal(candidate.semanticSimilarity);
	return Math.max(lexical, semantic * 0.96, lexical * 0.58 + semantic * 0.5);
}

function publicCandidate(candidate: SearchCandidate) {
	return Object.freeze({
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
	});
}

function lexicalCandidate(row: LexicalRow): SearchCandidate {
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
		score: 0,
		matchMode: 'lexical'
	};
	candidate.score = scoreCandidate(candidate);
	return candidate;
}

function mergeCandidates(lexical: readonly LexicalRow[], semantic: readonly SemanticRow[]) {
	const merged = new Map<string, SearchCandidate>();
	for (const row of lexical) merged.set(row.page_id, lexicalCandidate(row));
	for (const row of semantic) {
		if (row.semantic_similarity < MIN_SEMANTIC_SIMILARITY) continue;
		const current = merged.get(row.page_id);
		if (current) {
			current.semanticSimilarity = row.semantic_similarity;
			current.matchMode = 'hybrid';
			if (
				semanticSignal(row.semantic_similarity) > lexicalSignal(current.lexicalRank) &&
				row.excerpt.trim()
			) {
				current.excerpt = row.excerpt.slice(0, 2000);
			}
			current.score = scoreCandidate(current);
			continue;
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
			score: 0,
			matchMode: 'semantic'
		};
		candidate.score = scoreCandidate(candidate);
		merged.set(row.page_id, candidate);
	}
	return [...merged.values()].sort((left, right) => {
		if (right.score !== left.score) return right.score - left.score;
		if (right.lexicalRank !== left.lexicalRank) return right.lexicalRank - left.lexicalRank;
		if (right.semanticSimilarity !== left.semanticSimilarity)
			return right.semanticSimilarity - left.semanticSimilarity;
		const title = left.documentTitle.localeCompare(right.documentTitle, 'pt-BR');
		return title !== 0 ? title : left.pageNumber - right.pageNumber;
	});
}

function lexicalResponse(
	rows: readonly LexicalRow[],
	input: ParsedRequest,
	reason: string,
	embeddingModel: string | null = null,
	index: Record<string, unknown> | null = null
) {
	return {
		mode: 'lexical',
		reason,
		embeddingModel,
		index,
		hasMore: rows.length === input.limit,
		results: rows.map((row) => publicCandidate(lexicalCandidate(row)))
	};
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);
	if (!appOrigin) return respond(503, { code: 'search_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer '))
		return respond(401, { code: 'authentication_required' });

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

	const abort = new AbortController();
	const timeoutMs = envInteger('SEMANTIC_SEARCH_TIMEOUT_MS', 30_000, 5_000, 90_000) ?? 30_000;
	const timeout = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const apiKey = Deno.env.get('GEMINI_API_KEY');
		const embeddingModel = Deno.env.get('SEMANTIC_EMBEDDING_MODEL') ?? 'gemini-embedding-2';
		const { data: consent, error: consentError } = await supabase.rpc(
			'has_search_semantic_consent',
			{
				consent_version: CONSENT_VERSION
			}
		);

		if (
			parsed.query.length < MIN_SEMANTIC_QUERY_CHARS ||
			consentError ||
			consent !== true ||
			!apiKey ||
			!MODEL.test(embeddingModel) ||
			parsed.offset + parsed.limit > MAX_HYBRID_WINDOW
		) {
			const rows = await lexicalRows(supabase, parsed, parsed.limit, parsed.offset);
			let reason = 'semantic_not_configured';
			if (parsed.query.length < MIN_SEMANTIC_QUERY_CHARS) reason = 'query_too_short';
			else if (!consentError && consent !== true) reason = 'consent_required';
			else if (parsed.offset + parsed.limit > MAX_HYBRID_WINDOW)
				reason = 'semantic_window_exhausted';
			return respond(200, lexicalResponse(rows, parsed, reason));
		}

		const pageBudget = envInteger('SEMANTIC_SEARCH_INDEX_BATCH_PAGES', 4, 1, 16) ?? 4;
		let indexedThisRun = 0;
		try {
			indexedThisRun = await indexPages({
				supabase,
				apiKey,
				model: embeddingModel,
				notebookId: parsed.notebookId,
				pageBudget,
				signal: abort.signal
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			// Existing current embeddings remain usable even if this opportunistic batch fails.
		}

		let queryVector: readonly number[];
		try {
			const vectors = await requestGeminiEmbeddingsWithTelemetry({
				supabase,
				apiKey,
				model: embeddingModel,
				inputs: [{ text: parsed.query }],
				taskType: 'RETRIEVAL_QUERY',
				outputDimensionality: EMBEDDING_DIMENSIONS,
				operation: 'query_embedding',
				surface: 'search',
				signal: abort.signal
			});
			queryVector = vectors[0]!;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			const rows = await lexicalRows(supabase, parsed, parsed.limit, parsed.offset);
			const stats = await indexStats(supabase, embeddingModel, parsed.notebookId);
			return respond(
				200,
				lexicalResponse(
					rows,
					parsed,
					error instanceof GeminiEmbeddingHttpError && error.status === 429
						? 'semantic_quota_or_rate_limit'
						: 'semantic_provider_unavailable',
					embeddingModel,
					stats ? { ...stats, indexedThisRun } : null
				)
			);
		}

		const candidateLimit = Math.min(
			MAX_HYBRID_WINDOW,
			Math.max(parsed.offset + parsed.limit + 20, parsed.limit * 2)
		);
		const [lexical, semanticResponse] = await Promise.all([
			lexicalRows(supabase, parsed, candidateLimit, 0),
			supabase.rpc('search_pages_semantic', {
				query_embedding: embeddingVectorText(queryVector),
				target_model: embeddingModel,
				notebook_filter: parsed.notebookId,
				result_limit: Math.min(50, candidateLimit)
			})
		]);
		const semantic =
			!semanticResponse.error && Array.isArray(semanticResponse.data)
				? semanticResponse.data.filter(validSemanticRow)
				: [];
		const ranked = mergeCandidates(lexical, semantic);
		const end = parsed.offset + parsed.limit;
		const results = ranked.slice(parsed.offset, end).map(publicCandidate);
		const stats = await indexStats(supabase, embeddingModel, parsed.notebookId);
		return respond(200, {
			mode: 'hybrid',
			reason: null,
			embeddingModel,
			index: stats ? { ...stats, indexedThisRun } : null,
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
