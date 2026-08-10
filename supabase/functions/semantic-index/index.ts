import { createClient } from 'npm:@supabase/supabase-js@2';
import { RequestBodyTooLargeError, readBoundedJson } from '../_shared/bounded-json.ts';
import { corsHeaders, parseAppOrigin } from '../_shared/cors.ts';
import {
	SEMANTIC_CONSENT_VERSION,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_INDEX_BATCH_PAGES,
	SEMANTIC_INDEX_MAX_BATCHES,
	SEMANTIC_INDEX_PAGE_CONCURRENCY
} from '../_shared/semantic-config.ts';
import { indexNextSemanticBatch, semanticIndexStats } from '../_shared/semantic-indexer.ts';
import { recordSemanticRetrievalEvent } from '../_shared/semantic-retrieval-telemetry.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;

type ParsedRequest = Readonly<{
	notebookId: string | null;
	batchSize: number;
	maxBatches: number;
	concurrency: number;
}>;

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

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
	if (value === undefined) return fallback;
	return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
		? Number(value)
		: null;
}

function parseRequest(value: unknown): ParsedRequest | null {
	if (value === null || value === undefined) value = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const allowed = new Set(['notebookId', 'batchSize', 'maxBatches', 'concurrency']);
	if (Object.keys(record).some((key) => !allowed.has(key))) return null;
	const notebookId = record.notebookId ?? null;
	if (notebookId !== null && (typeof notebookId !== 'string' || !UUID.test(notebookId)))
		return null;
	const batchSize = boundedInteger(record.batchSize, SEMANTIC_INDEX_BATCH_PAGES, 1, 24);
	const maxBatches = boundedInteger(record.maxBatches, SEMANTIC_INDEX_MAX_BATCHES, 1, 32);
	const concurrency = boundedInteger(record.concurrency, SEMANTIC_INDEX_PAGE_CONCURRENCY, 1, 4);
	if (batchSize === null || maxBatches === null || concurrency === null) return null;
	return { notebookId: notebookId as string | null, batchSize, maxBatches, concurrency };
}

Deno.serve(async (request) => {
	const appOrigin = parseAppOrigin(Deno.env.get('APP_ORIGIN'));
	const respond = (status: number, body: Record<string, unknown>) => json(status, body, appOrigin);
	if (!appOrigin) return respond(503, { code: 'semantic_index_not_configured' });
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
			? respond(413, { code: 'semantic_index_request_too_large' })
			: respond(400, { code: 'invalid_json' });
	}
	const parsed = parseRequest(raw);
	if (!parsed) return respond(400, { code: 'invalid_semantic_index_request' });

	const supabaseUrl = Deno.env.get('SUPABASE_URL');
	const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
	const apiKey = Deno.env.get('GEMINI_API_KEY');
	if (!supabaseUrl || !publishableKey || !apiKey)
		return respond(503, { code: 'semantic_index_not_configured' });

	const supabase = createClient(supabaseUrl, publishableKey, {
		global: { headers: { Authorization: authorization } },
		auth: { persistSession: false, autoRefreshToken: false }
	});
	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user) return respond(401, { code: 'authentication_required' });

	const [searchConsent, coverageConsent] = await Promise.all([
		supabase.rpc('has_search_semantic_consent', { consent_version: SEMANTIC_CONSENT_VERSION }),
		supabase.rpc('has_coverage_semantic_consent', { consent_version: SEMANTIC_CONSENT_VERSION })
	]);
	if (searchConsent.data !== true && coverageConsent.data !== true) {
		return respond(403, { code: 'semantic_consent_required' });
	}

	const startedAt = performance.now();
	const abort = new AbortController();
	const timeout = setTimeout(() => abort.abort(), 110_000);
	let processedPages = 0;
	let indexedPages = 0;
	let failedPages = 0;
	let storedChunks = 0;
	let batches = 0;
	let stopReason:
		'complete' | 'batch_limit' | 'rate_limited' | 'no_progress' | 'timeout' | 'provider_error' =
		'batch_limit';

	try {
		await supabase.rpc('prune_stale_semantic_chunks', { target_model: SEMANTIC_EMBEDDING_MODEL });
		await supabase.rpc('prune_semantic_query_embedding_cache');

		for (let batch = 0; batch < parsed.maxBatches; batch += 1) {
			batches += 1;
			const result = await indexNextSemanticBatch({
				supabase,
				apiKey,
				notebookId: parsed.notebookId,
				batchPages: parsed.batchSize,
				concurrency: parsed.concurrency,
				surface: 'indexer',
				signal: abort.signal
			});
			processedPages += result.attemptedPages;
			indexedPages += result.indexedPages;
			failedPages += result.failedPages;
			storedChunks += result.storedChunks;
			if (result.rateLimited) {
				stopReason = 'rate_limited';
				break;
			}
			if (result.attemptedPages === 0) {
				stopReason = 'complete';
				break;
			}
			if (result.indexedPages === 0) {
				stopReason = 'no_progress';
				break;
			}
		}

		const stats = await semanticIndexStats(supabase, parsed.notebookId);
		if (stats.remainingPages === 0) stopReason = 'complete';
		await recordSemanticRetrievalEvent(supabase, {
			surface: 'indexer',
			mode: 'indexing',
			model: SEMANTIC_EMBEDDING_MODEL,
			resultCount: indexedPages,
			totalPages: stats.totalPages,
			indexedPages: stats.indexedPages,
			durationMs: performance.now() - startedAt,
			fallbackReason: stopReason === 'complete' ? null : stopReason
		});

		return respond(200, {
			model: SEMANTIC_EMBEDDING_MODEL,
			processedPages,
			indexedPages,
			failedPages,
			storedChunks,
			batches,
			stopReason,
			complete: stats.remainingPages === 0,
			index: stats
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			stopReason = 'timeout';
			return respond(504, {
				code: 'semantic_index_timeout',
				model: SEMANTIC_EMBEDDING_MODEL,
				processedPages,
				indexedPages,
				failedPages,
				storedChunks,
				batches,
				stopReason
			});
		}
		return respond(503, {
			code: 'semantic_index_unavailable',
			model: SEMANTIC_EMBEDDING_MODEL,
			processedPages,
			indexedPages,
			failedPages,
			storedChunks,
			batches,
			stopReason: 'provider_error'
		});
	} finally {
		clearTimeout(timeout);
	}
});
