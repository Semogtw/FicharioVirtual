import { z } from 'zod';
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

const candidateSchema = z
	.object({
		pageId: z.string().regex(UUID),
		documentId: z.string().regex(UUID),
		documentTitle: z.string().trim().min(1).max(240),
		notebookId: z.string().regex(UUID).nullable(),
		notebookName: z.string().max(120).nullable(),
		pageNumber: z.number().int().min(1).max(10_000),
		excerpt: z.string().max(2_400),
		lexicalRank: z.number().finite().nonnegative(),
		semanticSimilarity: z.number().finite().min(0).max(1)
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.notebookId === null) !== (value.notebookName === null)) {
			context.addIssue({ code: 'custom', message: 'Invalid semantic notebook metadata' });
		}
	});

const indexSchema = z
	.object({
		totalPages: z.number().int().nonnegative(),
		indexedPages: z.number().int().nonnegative(),
		complete: z.boolean()
	})
	.strict()
	.superRefine((value, context) => {
		if (
			value.indexedPages > value.totalPages ||
			value.complete !== (value.indexedPages === value.totalPages)
		) {
			context.addIssue({ code: 'custom', message: 'Invalid semantic coverage index' });
		}
	});

const responseSchema = z
	.object({
		mode: z.enum(['hybrid', 'lexical']),
		reason: z.string().regex(REASON).nullable(),
		embeddingModel: z.string().regex(MODEL).nullable(),
		index: indexSchema.nullable(),
		topics: z.array(
			z
				.object({
					topic: z.string(),
					candidates: z.array(candidateSchema).max(MAX_CANDIDATES_PER_TOPIC)
				})
				.strict()
		)
	})
	.strict();

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

function invalidResponse(): never {
	throw new SemanticCoverageServiceError('O serviço semântico devolveu uma resposta inválida.');
}

function parseResponse(value: unknown, requestedTopics: readonly string[]): SemanticCoverageResponse {
	const parsed = responseSchema.safeParse(value);
	if (!parsed.success || parsed.data.topics.length !== requestedTopics.length) invalidResponse();
	if (parsed.data.mode === 'hybrid' && parsed.data.embeddingModel === null) invalidResponse();

	const topics = parsed.data.topics.map((item, index) => {
		if (item.topic !== requestedTopics[index]) invalidResponse();
		if (new Set(item.candidates.map((candidate) => candidate.pageId)).size !== item.candidates.length) {
			invalidResponse();
		}
		return Object.freeze({
			topic: item.topic,
			candidates: Object.freeze(
				item.candidates.map((candidate) =>
					Object.freeze({ ...candidate, verification: null }) as SemanticCoverageCandidate
				)
		});
	});

	const analysis: CoverageAnalysisMetadata = Object.freeze({
		mode: parsed.data.mode,
		reason: parsed.data.reason,
		embeddingModel: parsed.data.embeddingModel,
		index: parsed.data.index
			? Object.freeze({ ...parsed.data.index, indexedThisRun: 0 })
			: null,
		verification: 'disabled'
	});
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
	if (notebookId !== null && !UUID.test(notebookId)) throw new TypeError('Invalid semantic notebook');
	if (options.signal?.aborted) throw new DOMException('Coverage analysis cancelled', 'AbortError');

	try {
		const { data, error } = await client.functions.invoke('semantic-coverage', {
			body: { topics, notebookId },
			signal: options.signal
		});
		if (error) {
			if (options.signal?.aborted) throw new DOMException('Coverage analysis cancelled', 'AbortError');
			throw new SemanticCoverageServiceError();
		}
		return parseResponse(data, topics);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		if (error instanceof SemanticCoverageServiceError) throw error;
		throw new SemanticCoverageServiceError();
	}
}
