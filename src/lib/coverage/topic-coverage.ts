import type { SearchResult } from '$lib/services/search';

export const MAX_UNIT_TOPICS = 40;
export const MAX_TOPIC_LENGTH = 200;
export const MAX_EVIDENCE_PER_TOPIC = 4;

export const COVERED_RANK_THRESHOLD = 0.85;
export const PARTIAL_RANK_THRESHOLD = 0.4;

export type TopicCoverageStatus = 'covered' | 'partial' | 'missing';

export type TopicCoverageEvidence = Pick<
	SearchResult,
	| 'pageId'
	| 'documentId'
	| 'documentTitle'
	| 'notebookId'
	| 'notebookName'
	| 'pageNumber'
	| 'excerpt'
	| 'rank'
>;

export type TopicCoverage = {
	topic: string;
	status: TopicCoverageStatus;
	strength: number;
	evidence: readonly TopicCoverageEvidence[];
};

export type UnitCoverageSummary = {
	topics: readonly TopicCoverage[];
	percentage: number;
	counts: Readonly<Record<TopicCoverageStatus, number>>;
};

const listPrefix = /^\s*(?:(?:[-*•–—]\s*)|(?:\(?\d+(?:\.\d+)*[.)-]?\s+)|(?:[A-Za-z][.)]\s+))/;

export function normalizeTopic(value: string) {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('pt-BR')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function cleanTopicLine(value: string) {
	return value.replace(listPrefix, '').trim().replace(/\s+/g, ' ');
}

export function parseUnitTopics(input: string): readonly string[] {
	const topics: string[] = [];
	const seen = new Set<string>();

	for (const rawLine of input.split(/\r?\n|;/)) {
		const topic = cleanTopicLine(rawLine);
		if (!topic) continue;
		if (topic.length > MAX_TOPIC_LENGTH) {
			throw new TypeError(`Cada assunto pode ter no máximo ${MAX_TOPIC_LENGTH} caracteres.`);
		}

		const normalized = normalizeTopic(topic);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		topics.push(topic);

		if (topics.length > MAX_UNIT_TOPICS) {
			throw new TypeError(`Uma análise pode ter no máximo ${MAX_UNIT_TOPICS} assuntos.`);
		}
	}

	return Object.freeze(topics);
}

function evidenceKey(result: SearchResult) {
	return `${result.documentId}:${result.pageId}`;
}

export function selectCoverageEvidence(
	results: readonly SearchResult[],
	limit = MAX_EVIDENCE_PER_TOPIC
): readonly TopicCoverageEvidence[] {
	if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
		throw new TypeError('Invalid coverage evidence limit');
	}

	const sorted = [...results].sort((left, right) => right.rank - left.rank);
	const seen = new Set<string>();
	const selected: TopicCoverageEvidence[] = [];

	for (const result of sorted) {
		const key = evidenceKey(result);
		if (seen.has(key)) continue;
		seen.add(key);
		selected.push(Object.freeze({ ...result }));
		if (selected.length >= limit) break;
	}

	return Object.freeze(selected);
}

export function classifyTopicCoverage(
	topic: string,
	results: readonly SearchResult[]
): TopicCoverage {
	const evidence = selectCoverageEvidence(results);
	const bestRank = evidence[0]?.rank ?? 0;
	const status: TopicCoverageStatus =
		bestRank >= COVERED_RANK_THRESHOLD
			? 'covered'
			: bestRank >= PARTIAL_RANK_THRESHOLD
				? 'partial'
				: 'missing';

	return Object.freeze({
		topic,
		status,
		strength: Math.round(Math.min(1, Math.max(0, bestRank / COVERED_RANK_THRESHOLD)) * 100),
		evidence
	});
}

export function summarizeUnitCoverage(topics: readonly TopicCoverage[]): UnitCoverageSummary {
	const counts: Record<TopicCoverageStatus, number> = {
		covered: 0,
		partial: 0,
		missing: 0
	};
	let weightedCoverage = 0;

	for (const topic of topics) {
		counts[topic.status] += 1;
		weightedCoverage += topic.status === 'covered' ? 1 : topic.status === 'partial' ? 0.5 : 0;
	}

	const percentage = topics.length === 0 ? 0 : Math.round((weightedCoverage / topics.length) * 100);
	return Object.freeze({
		topics: Object.freeze([...topics]),
		percentage,
		counts: Object.freeze(counts)
	});
}
