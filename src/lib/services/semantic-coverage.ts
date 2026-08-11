import {
	type CoverageAnalysisMetadata,
	type SemanticCoverageCandidate
} from '$lib/coverage/semantic-coverage';
import { MAX_UNIT_TOPICS, MAX_TOPIC_LENGTH } from '$lib/coverage/topic-coverage';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9._-]{3,128}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_CANDIDATES_PER_TOPIC = 8;

type FunctionError = { context?: unknown; message?: string };
type SemanticCoverageFunctionClient = {
	functions: {
		invoke(
			name: 'semantic-coverage',
			options: {
				body: { topics: readonly string[]; notebookId: string | null };
				signal?: AbortSignal;
			}
		): Promise<{ data: unknown; error: FunctionError | null }>;
	};
};

export type SemanticCoverageResponse = Readonly<{
	analysis: CoverageAnalysisMetadata;
	topics: readonly Readonly<{
		topic: string;
		candidates: readonly SemanticCoverageCandidate[];
	}>[];
}>;

export class SemanticCoverageServiceError extends Error {
	constructor(message = 'A análise semântica não está disponível agora.') {
		super(message);
		this.name = 'SemanticCoverageServiceError';
	}
}

function defaultFunctionClient(): SemanticCoverageFunctionClient {
	return getSupabaseClient() as unknown as SemanticCoverageFunctionClient;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function invalidResponse(): never {
	throw new SemanticCoverageServiceError('O serviço semântico devolveu uma resposta inválida.');
}

function finiteUnit(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseVerification(value: unknown): SemanticCoverageCandidate['verification'] {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
	const record = value as Record<string, unknown>;
	if (
		!exactKeys(record, ['confidence', 'coverage']) ||
		(record.coverage !== 'strong' && record.coverage !== 'partial' && record.coverage !== 'none') ||
		!finiteUnit(record.confidence)
	) {
		invalidResponse();
	}
	return Object.freeze({
		coverage: record.coverage,
		confidence: record.confidence as number
	});
}

function parseCandidate(value: unknown): SemanticCoverageCandidate {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
	const record = value as Record<string, unknown>;
	if (
		!exactKeys(record, [
			'documentId',
			'documentTitle',
			'excerpt',
			'lexicalRank',
			'notebookId',
			'notebookName',
			'pageId',
			'pageNumber',
			'semanticSimilarity',
			'verification'
		]) ||
		typeof record.pageId !== 'string' ||
		!UUID.test(record.pageId) ||
		typeof record.documentId !== 'string' ||
		!UUID.test(record.documentId) ||
		typeof record.documentTitle !== 'string' ||
		record.documentTitle.trim().length < 1 ||
		record.documentTitle.length > 240 ||
		(record.notebookId !== null &&
			(typeof record.notebookId !== 'string' || !UUID.test(record.notebookId))) ||
		(record.notebookName !== null &&
			(typeof record.notebookName !== 'string' || record.notebookName.length > 120)) ||
		Number.isInteger(record.pageNumber) === false ||
		Number(record.pageNumber) < 1 ||
		Number(record.pageNumber) > 10_000 ||
		typeof record.excerpt !== 'string' ||
		record.excerpt.length > 2_400 ||
		typeof record.lexicalRank !== 'number' ||
		!Number.isFinite(record.lexicalRank) ||
		record.lexicalRank < 0 ||
		!finiteUnit(record.semanticSimilarity)
	) {
		invalidResponse();
	}
	if ((record.notebookId === null) !== (record.notebookName === null)) invalidResponse();
	return Object.freeze({
		pageId: record.pageId,
		documentId: record.documentId,
		documentTitle: record.documentTitle.trim(),
		notebookId: record.notebookId as string | null,
		notebookName: record.notebookName as string | null,
		pageNumber: record.pageNumber as number,
		excerpt: record.excerpt,
		lexicalRank: record.lexicalRank,
		semanticSimilarity: record.semanticSimilarity as number,
		verification: parseVerification(record.verification)
	});
}

function parseIndex(value: unknown): CoverageAnalysisMetadata['index'] {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
	const record = value as Record<string, unknown>;
	if (!exactKeys(record, ['complete', 'indexedPages', 'indexedThisRun', 'totalPages'])) {
		invalidResponse();
	}
	if (
		!Number.isSafeInteger(record.totalPages) ||
		Number(record.totalPages) < 0 ||
		!Number.isSafeInteger(record.indexedPages) ||
		Number(record.indexedPages) < 0 ||
		Number(record.indexedPages) > Number(record.totalPages) ||
		!Number.isSafeInteger(record.indexedThisRun) ||
		Number(record.indexedThisRun) < 0 ||
		Number(record.indexedThisRun) > 32 ||
		typeof record.complete !== 'boolean' ||
		record.complete !== (record.indexedPages === record.totalPages)
	) {
		invalidResponse();
	}
	return Object.freeze({
		totalPages: record.totalPages as number,
		indexedPages: record.indexedPages as number,
		indexedThisRun: record.indexedThisRun as number,
		complete: record.complete
	});
}

function parseResponse(
	value: unknown,
	requestedTopics: readonly string[]
): SemanticCoverageResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
	const record = value as Record<string, unknown>;
	if (
		!exactKeys(record, ['embeddingModel', 'index', 'mode', 'reason', 'topics', 'verification']) ||
		(record.mode !== 'hybrid' && record.mode !== 'lexical') ||
		(record.reason !== null &&
			(typeof record.reason !== 'string' || !REASON.test(record.reason))) ||
		(record.embeddingModel !== null &&
			(typeof record.embeddingModel !== 'string' || !MODEL.test(record.embeddingModel))) ||
		(record.verification !== 'used' &&
			record.verification !== 'unavailable' &&
			record.verification !== 'disabled' &&
			record.verification !== 'skipped') ||
		!Array.isArray(record.topics) ||
		record.topics.length !== requestedTopics.length
	) {
		invalidResponse();
	}

	const topics = record.topics.map((raw, index) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidResponse();
		const topicRecord = raw as Record<string, unknown>;
		if (
			!exactKeys(topicRecord, ['candidates', 'topic']) ||
			topicRecord.topic !== requestedTopics[index] ||
			!Array.isArray(topicRecord.candidates) ||
			topicRecord.candidates.length > MAX_CANDIDATES_PER_TOPIC
		) {
			invalidResponse();
		}
		const candidates = topicRecord.candidates.map(parseCandidate);
		if (new Set(candidates.map((candidate) => candidate.pageId)).size !== candidates.length) {
			invalidResponse();
		}
		return Object.freeze({ topic: requestedTopics[index]!, candidates: Object.freeze(candidates) });
	});

	const analysis: CoverageAnalysisMetadata = Object.freeze({
		mode: record.mode,
		reason: record.reason as string | null,
		embeddingModel: record.embeddingModel as string | null,
		index: parseIndex(record.index),
		verification: record.verification
	});
	if (analysis.mode === 'hybrid' && analysis.embeddingModel === null) invalidResponse();
	return Object.freeze({ analysis, topics: Object.freeze(topics) });
}

function validateTopics(topics: readonly string[]) {
	if (
		topics.length < 1 ||
		topics.length > MAX_UNIT_TOPICS ||
		topics.some((topic) => topic.trim().length < 1 || topic.length > MAX_TOPIC_LENGTH)
	) {
		throw new TypeError('Invalid semantic coverage topics');
	}
}

export async function requestSemanticCoverage(
	topics: readonly string[],
	options: { notebookId?: string | null; signal?: AbortSignal } = {},
	client: SemanticCoverageFunctionClient = defaultFunctionClient()
): Promise<SemanticCoverageResponse> {
	validateTopics(topics);
	const notebookId = options.notebookId ?? null;
	if (notebookId !== null && !UUID.test(notebookId))
		throw new TypeError('Invalid semantic notebook');
	if (options.signal?.aborted) throw new DOMException('Coverage analysis cancelled', 'AbortError');

	try {
		const { data, error } = await client.functions.invoke('semantic-coverage', {
			body: { topics, notebookId },
			signal: options.signal
		});
		if (error) {
			if (options.signal?.aborted)
				throw new DOMException('Coverage analysis cancelled', 'AbortError');
			throw new SemanticCoverageServiceError();
		}
		return parseResponse(data, topics);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (error instanceof SemanticCoverageServiceError) throw error;
		throw new SemanticCoverageServiceError();
	}
}
