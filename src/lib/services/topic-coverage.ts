import {
	classifyTopicCoverage,
	parseUnitTopics,
	summarizeUnitCoverage,
	type UnitCoverageSummary
} from '$lib/coverage/topic-coverage';
import { searchPages, type SearchOptions, type SearchResult } from './search';

const DEFAULT_CONCURRENCY = 4;
const SEARCH_LIMIT_PER_TOPIC = 8;

export type TopicCoverageOptions = {
	notebookId?: string | null;
	signal?: AbortSignal;
	concurrency?: number;
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

export async function analyzeUnitCoverage(
	input: string | readonly string[],
	options: TopicCoverageOptions = {},
	search: TopicSearch = searchPages
): Promise<UnitCoverageSummary> {
	const topics = typeof input === 'string' ? parseUnitTopics(input) : Object.freeze([...input]);
	if (topics.length === 0) return summarizeUnitCoverage([]);

	const concurrency = validateConcurrency(options.concurrency ?? DEFAULT_CONCURRENCY);
	const results = new Array<Awaited<ReturnType<typeof classifyTopicCoverage>>>(topics.length);
	let nextIndex = 0;

	async function worker() {
		while (true) {
			throwIfAborted(options.signal);
			const index = nextIndex++;
			if (index >= topics.length) return;
			const topic = topics[index];
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
	return summarizeUnitCoverage(results);
}
