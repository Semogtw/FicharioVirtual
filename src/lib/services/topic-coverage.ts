import {
	classifySemanticTopicCoverage,
	summarizeSemanticCoverage,
	type AnalyzedUnitCoverageSummary,
	type CoverageAnalysisMetadata,
	type SemanticCoverageCandidate
} from '$lib/coverage/semantic-coverage';
import {
	classifyTopicCoverage,
	parseUnitTopics,
	summarizeUnitCoverage
} from '$lib/coverage/topic-coverage';
import { requestSemanticCoverage } from './semantic-coverage';
import { searchPages, type SearchOptions, type SearchResult } from './search';

const DEFAULT_CONCURRENCY = 4;
const SEARCH_LIMIT_PER_TOPIC = 8;

export type TopicCoverageOptions = {
	notebookId?: string | null;
	signal?: AbortSignal;
	concurrency?: number;
	semantic?: boolean;
};

export type TopicSearch = (
	query: string,
	options?: SearchOptions
) => Promise<readonly SearchResult[]>;

function validateConcurrency(value: number) {
	if (!Number.isInteger(value) || value < 1 || value > 8) {
		throw new TypeError('Invalid coverage concurrency');
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException('Coverage analysis cancelled', 'AbortError');
}

function lexicalResult(candidate: SemanticCoverageCandidate): SearchResult {
	return Object.freeze({
		pageId: candidate.pageId,
		documentId: candidate.documentId,
		documentTitle: candidate.documentTitle,
		notebookId: candidate.notebookId,
		notebookName: candidate.notebookName,
		pageNumber: candidate.pageNumber,
		excerpt: candidate.excerpt,
		rank: candidate.lexicalRank
	});
}

async function analyzeLexically(
	topics: readonly string[],
	options: TopicCoverageOptions,
	search: TopicSearch
) {
	const concurrency = validateConcurrency(options.concurrency ?? DEFAULT_CONCURRENCY);
	const results = new Array<Awaited<ReturnType<typeof classifyTopicCoverage>>>(topics.length);
	let nextIndex = 0;

	async function worker() {
		while (true) {
			throwIfAborted(options.signal);
			const index = nextIndex++;
			if (index >= topics.length) return;
			const topic = topics[index]!;
			const matches = await search(topic, {
				notebookId: options.notebookId ?? null,
				limit: SEARCH_LIMIT_PER_TOPIC,
				offset: 0,
				signal: options.signal
			});
			throwIfAborted(options.signal);
			results[index] = classifyTopicCoverage(topic, matches);
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, topics.length) }, () => worker()));
	return results;
}

function localFallbackAnalysis(reason: string): CoverageAnalysisMetadata {
	return Object.freeze({
		mode: 'lexical',
		reason,
		embeddingModel: null,
		index: null,
		verification: 'unavailable'
	});
}

export async function analyzeUnitCoverage(
	input: string | readonly string[],
	options: TopicCoverageOptions = {},
	search: TopicSearch = searchPages
): Promise<AnalyzedUnitCoverageSummary> {
	const topics = typeof input === 'string' ? parseUnitTopics(input) : Object.freeze([...input]);
	if (topics.length === 0) return summarizeUnitCoverage([]);

	if (options.semantic === true && search === searchPages) {
		try {
			const response = await requestSemanticCoverage(topics, {
				notebookId: options.notebookId ?? null,
				signal: options.signal
			});
			throwIfAborted(options.signal);

			if (response.analysis.mode === 'hybrid') {
				return summarizeSemanticCoverage(
					response.topics.map((item) =>
						classifySemanticTopicCoverage(item.topic, item.candidates)
					),
					response.analysis
				);
			}

			return summarizeSemanticCoverage(
				response.topics.map((item) =>
					classifyTopicCoverage(item.topic, item.candidates.map(lexicalResult))
				),
				response.analysis
			);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') throw error;
			const lexical = await analyzeLexically(topics, options, search);
			return summarizeSemanticCoverage(
				lexical,
				localFallbackAnalysis('semantic_function_unavailable')
			);
		}
	}

	return summarizeUnitCoverage(await analyzeLexically(topics, options, search));
}
