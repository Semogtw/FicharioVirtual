import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { embeddingVectorText, GeminiEmbeddingHttpError } from '../_shared/gemini-embedding-client.ts';
import { requestGeminiEmbeddingsWithTelemetry } from '../_shared/semantic-provider-telemetry.ts';
import {
	requestGeminiCoverageVerification,
	type CoverageVerificationVerdict
} from '../_shared/gemini-coverage-verifier.ts';
import { chunkSemanticText } from '../_shared/semantic-chunks.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_TOPICS = 40;
const MAX_TOPIC_CHARS = 200;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const EMBEDDING_DIMENSIONS = 768;
const SEMANTIC_RESULT_LIMIT = 8;
const LEXICAL_RESULT_LIMIT = 8;
const MAX_INDEX_CHUNKS_PER_RUN = 48;
const MAX_VERIFICATION_CANDIDATES = 24;
const CONSENT_VERSION = 1;

type ParsedRequest = Readonly<{
	topics: readonly string[];
	notebookId: string | null;
}>;

type EvidenceCandidate = {
	pageId: string;
	documentId: string;
	documentTitle: string;
	notebookId: string | null;
	notebookName: string | null;
	pageNumber: number;
	excerpt: string;
	lexicalRank: number;
	semanticSimilarity: number;
	verification: { coverage: 'strong' | 'partial' | 'none'; confidence: number } | null;
};

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

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function parseRequest(value: unknown): ParsedRequest | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!hasExactKeys(record, ['topics']) && !hasExactKeys(record, ['notebookId', 'topics'])) return null;
	if (
		!Array.isArray(record.topics) ||
		record.topics.length < 1 ||
		record.topics.length > MAX_TOPICS ||
		record.topics.some(
			(topic) => typeof topic !== 'string' || topic.trim().length < 1 || topic.length > MAX_TOPIC_CHARS
		) ||
		(record.notebookId !== undefined && record.notebookId !== null &&
			(typeof record.notebookId !== 'string' || !UUID.test(record.notebookId)))
	) {
		return null;
	}
	const normalized = (record.topics as string[]).map((topic) => topic.trim());
	if (new Set(normalized.map((topic) => topic.toLocaleLowerCase('pt-BR'))).size !== normalized.length) {
		return null;
	}
	return Object.freeze({
		topics: Object.freeze(normalized),
		notebookId: typeof record.notebookId === 'string' ? record.notebookId : null
	});
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
	const raw = Deno.env.get(name);
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function validEvidenceRow(value: unknown): value is LexicalRow {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, unknown>;
	return (
		typeof row.page_id === 'string' &&
		UUID.test(row.page_id) &&
		typeof row.document_id === 'string' &&
		UUID.test(row.document_id) &&
		typeof row.document_title === 'string' &&
		row.document_title.length > 0 &&
		(row.notebook_id === null || (typeof row.notebook_id === 'string' && UUID.test(row.notebook_id))) &&
		(row.notebook_name === null || typeof row.notebook_name === 'string') &&
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
		validEvidenceRow({ ...row, rank: 0 }) &&
		typeof row.semantic_similarity === 'number' &&
		Number.isFinite(row.semantic_similarity) &&
		row.semantic_similarity >= 0 &&
		row.semantic_similarity <= 1
	);
}

function roughSemanticSignal(similarity: number) {
	return Math.min(1, Math.max(0, (similarity - 0.44) / 0.36));
}

function roughScore(candidate: EvidenceCandidate) {
	const lexical = Math.min(1, Math.max(0, candidate.lexicalRank / 0.9));
	const semantic = roughSemanticSignal(candidate.semanticSimilarity);
	return Math.max(lexical * 0.94, semantic * 0.96, lexical * 0.55 + semantic * 0.52);
}

function candidateFromLexical(row: LexicalRow): EvidenceCandidate {
	return {
		pageId: row.page_id,
		documentId: row.document_id,
		documentTitle: row.document_title,
		notebookId: row.notebook_id,
		notebookName: row.notebook_name,
		pageNumber: row.page_number,
		excerpt: row.excerpt.slice(0, 2400),
		lexicalRank: row.rank,
		semanticSimilarity: 0,
		verification: null
	};
}

function mergeEvidence(lexical: readonly LexicalRow[], semantic: readonly SemanticRow[]) {
	const merged = new Map<string, EvidenceCandidate>();
	for (const row of lexical) merged.set(row.page_id, candidateFromLexical(row));
	for (const row of semantic) {
		const current = merged.get(row.page_id);
		if (current) {
			current.semanticSimilarity = row.semantic_similarity;
			if (row.semantic_similarity >= 0.5 && row.excerpt.trim()) current.excerpt = row.excerpt.slice(0, 2400);
		} else {
			merged.set(row.page_id, {
				pageId: row.page_id,
				documentId: row.document_id,
				documentTitle: row.document_title,
				notebookId: row.notebook_id,
				notebookName: row.notebook_name,
				pageNumber: row.page_number,
				excerpt: row.excerpt.slice(0, 2400),
				lexicalRank: 0,
				semanticSimilarity: row.semantic_similarity,
				verification: null
			});
		}
	}
	return [...merged.values()].sort((left, right) => roughScore(right) - roughScore(left)).slice(0, 8);
}

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<R>
) {
	const results = new Array<R>(items.length);
	let next = 0;
	async function run() {
		while (true) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await worker(items[index]!, index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
	return results;
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
		) continue;
		pages.push(row as IndexPage);
	}
	return Object.freeze(pages);
}

async function lexicalTopics(
	supabase: ReturnType<typeof createClient>,
	parsed: ParsedRequest
): Promise<readonly { topic: string; candidates: EvidenceCandidate[] }[]> {
	return mapWithConcurrency(parsed.topics, 4, async (topic) => {
		const { data, error } = await supabase.rpc('search_pages', {
			search_query: topic,
			notebook_filter: parsed.notebookId,
			result_limit: LEXICAL_RESULT_LIMIT,
			result_offset: 0
		});
		if (error) throw error;
		const rows = Array.isArray(data) ? data.filter(validEvidenceRow) : [];
		return { topic, candidates: rows.map(candidateFromLexical).slice(0, 8) };
	});
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
	const flattened: Array<{
		page: IndexPage;
		chunkIndex: number;
		chunkText: string;
	}> = [];
	for (const page of pages) {
		for (const chunk of chunkSemanticText(page.source_text)) {
			if (flattened.length >= MAX_INDEX_CHUNKS_PER_RUN) break;
			flattened.push({ page, chunkIndex: chunk.index, chunkText: chunk.text });
		}
		if (flattened.length >= MAX_INDEX_CHUNKS_PER_RUN) break;
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
		surface: 'coverage',
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
		const { data: stored, error: storeError } = await input.supabase.rpc('replace_page_semantic_chunks', {
			target_page_id: group.page.page_id,
			target_model: input.model,
			target_source_hash: group.page.source_hash,
			chunk_payload: group.chunks
		});
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
	if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(indexed) || indexed < 0 || indexed > total) {
		return null;
	}
	return Object.freeze({ totalPages: total, indexedPages: indexed, complete: indexed === total });
}

function applyVerdicts(
	topics: Array<{ topic: string; candidates: EvidenceCandidate[] }>,
	verdicts: readonly CoverageVerificationVerdict[]
) {
	for (const verdict of verdicts) {
		const candidate = topics[verdict.topicIndex]?.candidates[verdict.candidateIndex];
		if (!candidate) continue;
		candidate.verification = { coverage: verdict.coverage, confidence: verdict.confidence };
	}
}

async function verifyBestCandidates(input: {
	apiKey: string;
	model: string;
	topics: Array<{ topic: string; candidates: EvidenceCandidate[] }>;
	signal: AbortSignal;
}) {
	const selected: Array<{ topicIndex: number; candidateIndex: number; topic: string; excerpt: string }> = [];
	const ranked: Array<{ topicIndex: number; candidateIndex: number; score: number }> = [];
	input.topics.forEach((topic, topicIndex) => {
		topic.candidates.slice(0, 2).forEach((candidate, candidateIndex) => {
			const score = roughScore(candidate);
			if (score >= 0.4 && candidate.excerpt.trim()) ranked.push({ topicIndex, candidateIndex, score });
		});
	});
	ranked.sort((left, right) => right.score - left.score);
	for (const item of ranked.slice(0, MAX_VERIFICATION_CANDIDATES)) {
		const topic = input.topics[item.topicIndex]!;
		const candidate = topic.candidates[item.candidateIndex]!;
		selected.push({
			topicIndex: item.topicIndex,
			candidateIndex: item.candidateIndex,
			topic: topic.topic,
			excerpt: candidate.excerpt
		});
	}
	if (selected.length === 0) return 'skipped' as const;
	try {
		const verdicts = await requestGeminiCoverageVerification({
			apiKey: input.apiKey,
			model: input.model,
			candidates: selected,
			signal: input.signal
		});
		applyVerdicts(input.topics, verdicts);
		return 'used' as const;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return 'unavailable' as const;
	}
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);
	if (!appOrigin) return respond(503, { code: 'coverage_not_configured' });
	if (request.method === 'OPTIONS') return empty(204, appOrigin);
	if (request.method !== 'POST') return respond(405, { code: 'method_not_allowed' });

	const authorization = request.headers.get('Authorization');
	if (!authorization?.startsWith('Bearer ')) return respond(401, { code: 'authentication_required' });

	let raw: unknown;
	try {
		raw = await readBoundedJson(request, MAX_REQUEST_BODY_BYTES);
	} catch (error) {
		return error instanceof RequestBodyTooLargeError
			? respond(413, { code: 'coverage_request_too_large' })
			: respond(400, { code: 'invalid_json' });
	}
	const parsed = parseRequest(raw);
	if (!parsed) return respond(400, { code: 'invalid_coverage_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	if (!supabaseUrl || !publishableKey) return respond(503, { code: 'coverage_not_configured' });
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
	const timeoutMs = envInteger('SEMANTIC_COVERAGE_TIMEOUT_MS', 55_000, 5_000, 120_000) ?? 55_000;
	const timeout = setTimeout(() => abort.abort(), timeoutMs);
	try {
		const { data: consent, error: consentError } = await supabase.rpc('has_coverage_semantic_consent', {
			consent_version: CONSENT_VERSION
		});
		const apiKey = Deno.env.get('GEMINI_API_KEY');
		const embeddingModel = Deno.env.get('SEMANTIC_EMBEDDING_MODEL') ?? 'gemini-embedding-2';
		const verifyModel = Deno.env.get('COVERAGE_VERIFY_MODEL') ?? Deno.env.get('OCR_MODEL_PRIMARY') ?? null;
		const pageBudget = envInteger('SEMANTIC_INDEX_BATCH_PAGES', 8, 1, 32) ?? 8;
		const semanticConfigured =
			!consentError &&
			consent === true &&
			Boolean(apiKey) &&
			MODEL.test(embeddingModel);

		if (!semanticConfigured) {
			const topics = await lexicalTopics(supabase, parsed);
			return respond(200, {
				mode: 'lexical',
				reason: consent !== true ? 'consent_required' : 'semantic_not_configured',
				embeddingModel: null,
				index: null,
				verification: 'disabled',
				topics
			});
		}

		let indexedThisRun = 0;
		try {
			indexedThisRun = await indexPages({
				supabase,
				apiKey: apiKey!,
				model: embeddingModel,
				notebookId: parsed.notebookId,
				pageBudget,
				signal: abort.signal
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			// Query embeddings can still work against the already-current part of the index.
		}

		let queryVectors: readonly (readonly number[])[];
		try {
			queryVectors = await requestGeminiEmbeddingsWithTelemetry({
				supabase,
				apiKey: apiKey!,
				model: embeddingModel,
				inputs: parsed.topics.map((topic) => ({ text: topic })),
				taskType: 'RETRIEVAL_QUERY',
				outputDimensionality: EMBEDDING_DIMENSIONS,
				operation: 'query_embedding',
				surface: 'coverage',
				signal: abort.signal
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			const topics = await lexicalTopics(supabase, parsed);
			return respond(200, {
				mode: 'lexical',
				reason:
					error instanceof GeminiEmbeddingHttpError && error.status === 429
						? 'semantic_quota_or_rate_limit'
						: 'semantic_provider_unavailable',
				embeddingModel,
				index: await indexStats(supabase, embeddingModel, parsed.notebookId),
				verification: 'unavailable',
				topics
			});
		}

		const topics = await mapWithConcurrency(parsed.topics, 4, async (topic, index) => {
			const [lexicalResponse, semanticResponse] = await Promise.all([
				supabase.rpc('search_pages', {
					search_query: topic,
					notebook_filter: parsed.notebookId,
					result_limit: LEXICAL_RESULT_LIMIT,
					result_offset: 0
				}),
				supabase.rpc('search_pages_semantic', {
					query_embedding: embeddingVectorText(queryVectors[index]!),
					target_model: embeddingModel,
					notebook_filter: parsed.notebookId,
					result_limit: SEMANTIC_RESULT_LIMIT
				})
			]);
			if (lexicalResponse.error) throw lexicalResponse.error;
			const lexical = Array.isArray(lexicalResponse.data)
				? lexicalResponse.data.filter(validEvidenceRow)
				: [];
			const semantic =
				!semanticResponse.error && Array.isArray(semanticResponse.data)
					? semanticResponse.data.filter(validSemanticRow)
					: [];
			return { topic, candidates: mergeEvidence(lexical, semantic) };
		});

		const verification =
			verifyModel && MODEL.test(verifyModel)
				? await verifyBestCandidates({ apiKey: apiKey!, model: verifyModel, topics, signal: abort.signal })
				: 'disabled';
		const stats = await indexStats(supabase, embeddingModel, parsed.notebookId);
		return respond(200, {
			mode: 'hybrid',
			reason: null,
			embeddingModel,
			index: stats ? { ...stats, indexedThisRun } : null,
			verification,
			topics
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			return respond(504, { code: 'coverage_timeout' });
		}
		return respond(503, { code: 'coverage_unavailable' });
	} finally {
		clearTimeout(timeout);
	}
});
