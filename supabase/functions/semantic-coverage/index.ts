import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import { GeminiEmbeddingHttpError } from '../_shared/gemini-embedding-client.ts';
import {
	requestGeminiCoverageVerification,
	type CoverageVerificationVerdict
} from '../_shared/gemini-coverage-verifier.ts';
import {
	SEMANTIC_CONSENT_VERSION,
	SEMANTIC_COVERAGE_MIN_SIMILARITY,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_INDEX_BATCH_PAGES
} from '../_shared/semantic-config.ts';
import { indexNextSemanticBatch, semanticIndexStats } from '../_shared/semantic-indexer.ts';
import { getSemanticQueryEmbeddings } from '../_shared/semantic-query-cache.ts';
import { compareHybridRanked } from '../_shared/semantic-ranking.ts';
import { recordSemanticRetrievalEvent } from '../_shared/semantic-retrieval-telemetry.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const MAX_TOPICS = 40;
const MAX_TOPIC_CHARS = 200;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const SEMANTIC_RESULT_LIMIT = 8;
const LEXICAL_RESULT_LIMIT = 8;
const MAX_VERIFICATION_CANDIDATES = 24;

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

type TopicCandidates = { topic: string; candidates: EvidenceCandidate[]; semanticAvailable: boolean };

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
		(record.notebookId !== undefined &&
			record.notebookId !== null &&
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

function semanticSignal(similarity: number) {
	return Math.min(1, Math.max(0, (similarity - 0.45) / 0.33));
}

function verificationPriority(candidate: EvidenceCandidate) {
	const lexical = Math.min(1, Math.max(0, candidate.lexicalRank / 0.9));
	return Math.max(lexical, semanticSignal(candidate.semanticSimilarity));
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

function mergeEvidence(lexical: readonly LexicalRow[], semanticRows: readonly SemanticRow[]) {
	const merged = new Map<
		string,
		{
			candidate: EvidenceCandidate;
			lexicalRank: number | null;
			semanticRank: number | null;
			semanticSimilarity: number | null;
			stableKey: string;
		}
	>();

	lexical.forEach((row, index) => {
		merged.set(row.page_id, {
			candidate: candidateFromLexical(row),
			lexicalRank: index + 1,
			semanticRank: null,
			semanticSimilarity: null,
			stableKey: row.page_id
		});
	});

	semanticRows
		.filter((row) => row.semantic_similarity >= SEMANTIC_COVERAGE_MIN_SIMILARITY)
		.forEach((row, index) => {
			const current = merged.get(row.page_id);
			if (current) {
				current.semanticRank = index + 1;
				current.semanticSimilarity = row.semantic_similarity;
				current.candidate.semanticSimilarity = row.semantic_similarity;
				if (row.excerpt.trim()) current.candidate.excerpt = row.excerpt.slice(0, 2400);
				return;
			}
			merged.set(row.page_id, {
				candidate: {
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
				},
				lexicalRank: null,
				semanticRank: index + 1,
				semanticSimilarity: row.semantic_similarity,
				stableKey: row.page_id
			});
		});

	return [...merged.values()]
		.sort(compareHybridRanked)
		.slice(0, 8)
		.map((item) => item.candidate);
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

async function lexicalTopics(supabase: SupabaseClient, parsed: ParsedRequest) {
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

async function safeIndexStats(supabase: SupabaseClient, notebookId: string | null) {
	try {
		return await semanticIndexStats(supabase, notebookId);
	} catch {
		return null;
	}
}

function indexMetadata(
	stats: Awaited<ReturnType<typeof semanticIndexStats>> | null,
	indexedThisRun: number
) {
	if (!stats) return null;
	return {
		totalPages: stats.totalPages,
		indexedPages: stats.indexedPages,
		indexedThisRun,
		complete: stats.remainingPages === 0
	};
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
	const selected: Array<{
		topicIndex: number;
		candidateIndex: number;
		topic: string;
		excerpt: string;
	}> = [];
	const ranked: Array<{ topicIndex: number; candidateIndex: number; score: number }> = [];
	input.topics.forEach((topic, topicIndex) => {
		topic.candidates.slice(0, 2).forEach((candidate, candidateIndex) => {
			const score = verificationPriority(candidate);
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

function candidateTelemetry(topics: readonly { candidates: readonly EvidenceCandidate[] }[]) {
	let resultCount = 0;
	let lexicalOnlyCount = 0;
	let semanticOnlyCount = 0;
	let hybridCount = 0;
	for (const topic of topics) {
		for (const candidate of topic.candidates) {
			resultCount += 1;
			const lexical = candidate.lexicalRank > 0;
			const semantic = candidate.semanticSimilarity >= SEMANTIC_COVERAGE_MIN_SIMILARITY;
			if (lexical && semantic) hybridCount += 1;
			else if (semantic) semanticOnlyCount += 1;
			else lexicalOnlyCount += 1;
		}
	}
	return { resultCount, lexicalOnlyCount, semanticOnlyCount, hybridCount };
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
	const startedAt = performance.now();

	try {
		const { data: consent, error: consentError } = await supabase.rpc('has_coverage_semantic_consent', {
			consent_version: SEMANTIC_CONSENT_VERSION
		});
		const apiKey = Deno.env.get('GEMINI_API_KEY');
		const verifyModel = Deno.env.get('COVERAGE_VERIFY_MODEL') ?? Deno.env.get('OCR_MODEL_PRIMARY') ?? null;

		if (consentError || consent !== true || !apiKey) {
			const topics = await lexicalTopics(supabase, parsed);
			const reason = consentError || (consent === true && !apiKey) ? 'semantic_not_configured' : 'consent_required';
			await recordSemanticRetrievalEvent(supabase, {
				surface: 'topic_coverage',
				mode: 'fallback',
				model: null,
				resultCount: topics.reduce((sum, topic) => sum + topic.candidates.length, 0),
				durationMs: performance.now() - startedAt,
				fallbackReason: reason
			});
			return respond(200, {
				mode: 'lexical',
				reason,
				embeddingModel: null,
				index: null,
				verification: 'disabled',
				topics
			});
		}

		const pageBudget = envInteger('SEMANTIC_INDEX_BATCH_PAGES', SEMANTIC_INDEX_BATCH_PAGES, 1, 24) ?? SEMANTIC_INDEX_BATCH_PAGES;
		let indexedThisRun = 0;
		try {
			const batch = await indexNextSemanticBatch({
				supabase,
				apiKey,
				notebookId: parsed.notebookId,
				batchPages: pageBudget,
				surface: 'coverage',
				signal: abort.signal
			});
			indexedThisRun = batch.indexedPages;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			// Retrieval can continue against the already-current portion of the index.
		}

		let queryEmbeddings: Awaited<ReturnType<typeof getSemanticQueryEmbeddings>>;
		try {
			queryEmbeddings = await getSemanticQueryEmbeddings({
				supabase,
				apiKey,
				queries: parsed.topics,
				surface: 'coverage',
				signal: abort.signal
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			const topics = await lexicalTopics(supabase, parsed);
			const stats = await safeIndexStats(supabase, parsed.notebookId);
			const reason =
				error instanceof GeminiEmbeddingHttpError && error.status === 429
					? 'semantic_quota_or_rate_limit'
					: 'semantic_provider_unavailable';
			await recordSemanticRetrievalEvent(supabase, {
				surface: 'topic_coverage',
				mode: 'fallback',
				model: SEMANTIC_EMBEDDING_MODEL,
				resultCount: topics.reduce((sum, topic) => sum + topic.candidates.length, 0),
				totalPages: stats?.totalPages ?? null,
				indexedPages: stats?.indexedPages ?? null,
				durationMs: performance.now() - startedAt,
				fallbackReason: reason
			});
			return respond(200, {
				mode: 'lexical',
				reason,
				embeddingModel: SEMANTIC_EMBEDDING_MODEL,
				index: indexMetadata(stats, indexedThisRun),
				verification: 'unavailable',
				topics
			});
		}

		const topicCandidates: TopicCandidates[] = await mapWithConcurrency(parsed.topics, 4, async (topic, index) => {
			const [lexicalResponse, semanticResponse] = await Promise.all([
				supabase.rpc('search_pages', {
					search_query: topic,
					notebook_filter: parsed.notebookId,
					result_limit: LEXICAL_RESULT_LIMIT,
					result_offset: 0
				}),
				supabase.rpc('search_pages_semantic', {
					query_embedding: queryEmbeddings[index]!.vectorText,
					target_model: SEMANTIC_EMBEDDING_MODEL,
					notebook_filter: parsed.notebookId,
					result_limit: SEMANTIC_RESULT_LIMIT
				})
			]);
			if (lexicalResponse.error) throw lexicalResponse.error;
			const lexical = Array.isArray(lexicalResponse.data) ? lexicalResponse.data.filter(validEvidenceRow) : [];
			const semantic =
				!semanticResponse.error && Array.isArray(semanticResponse.data)
					? semanticResponse.data.filter(validSemanticRow)
					: [];
			return {
				topic,
				candidates: mergeEvidence(lexical, semantic),
				semanticAvailable: !semanticResponse.error
			};
		});

		const semanticAvailableCount = topicCandidates.filter((topic) => topic.semanticAvailable).length;
		const topics = topicCandidates.map(({ topic, candidates }) => ({ topic, candidates }));
		if (semanticAvailableCount === 0) {
			const stats = await safeIndexStats(supabase, parsed.notebookId);
			await recordSemanticRetrievalEvent(supabase, {
				surface: 'topic_coverage',
				mode: 'fallback',
				model: SEMANTIC_EMBEDDING_MODEL,
				resultCount: topics.reduce((sum, topic) => sum + topic.candidates.length, 0),
				totalPages: stats?.totalPages ?? null,
				indexedPages: stats?.indexedPages ?? null,
				durationMs: performance.now() - startedAt,
				queryEmbeddingCacheHit: queryEmbeddings.every((item) => item.cacheHit),
				fallbackReason: 'semantic_rpc_unavailable'
			});
			return respond(200, {
				mode: 'lexical',
				reason: 'semantic_rpc_unavailable',
				embeddingModel: SEMANTIC_EMBEDDING_MODEL,
				index: indexMetadata(stats, indexedThisRun),
				verification: 'unavailable',
				topics
			});
		}

		const verification =
			verifyModel && MODEL.test(verifyModel)
				? await verifyBestCandidates({ apiKey, model: verifyModel, topics, signal: abort.signal })
				: 'disabled';
		const stats = await safeIndexStats(supabase, parsed.notebookId);
		const counts = candidateTelemetry(topics);
		const partialSemanticFailure = semanticAvailableCount < topicCandidates.length;
		await recordSemanticRetrievalEvent(supabase, {
			surface: 'topic_coverage',
			mode: 'hybrid',
			model: SEMANTIC_EMBEDDING_MODEL,
			...counts,
			totalPages: stats?.totalPages ?? null,
			indexedPages: stats?.indexedPages ?? null,
			durationMs: performance.now() - startedAt,
			queryEmbeddingCacheHit: queryEmbeddings.every((item) => item.cacheHit),
			fallbackReason: partialSemanticFailure ? 'semantic_partial_unavailable' : null
		});

		return respond(200, {
			mode: 'hybrid',
			reason: partialSemanticFailure ? 'semantic_partial_unavailable' : null,
			embeddingModel: SEMANTIC_EMBEDDING_MODEL,
			index: indexMetadata(stats, indexedThisRun),
			verification,
			topics
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return respond(504, { code: 'coverage_timeout' });
		return respond(503, { code: 'coverage_unavailable' });
	} finally {
		clearTimeout(timeout);
	}
});
