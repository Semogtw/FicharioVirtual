import {
	MAX_EVIDENCE_PER_TOPIC,
	summarizeUnitCoverage,
	type TopicCoverage,
	type TopicCoverageStatus,
	type UnitCoverageSummary
} from './topic-coverage';

export type SemanticCoverageVerification = Readonly<{
	coverage: 'strong' | 'partial' | 'none';
	confidence: number;
}>;

export type SemanticCoverageCandidate = Readonly<{
	pageId: string;
	documentId: string;
	documentTitle: string;
	notebookId: string | null;
	notebookName: string | null;
	pageNumber: number;
	excerpt: string;
	lexicalRank: number;
	semanticSimilarity: number;
	verification: SemanticCoverageVerification | null;
}>;

export type SemanticCoverageIndex = Readonly<{
	totalPages: number;
	indexedPages: number;
	indexedThisRun: number;
	complete: boolean;
}>;

export type CoverageAnalysisMetadata = Readonly<{
	mode: 'hybrid' | 'lexical';
	reason: string | null;
	embeddingModel: string | null;
	index: SemanticCoverageIndex | null;
	verification: 'used' | 'unavailable' | 'disabled' | 'skipped';
}>;

export type AnalyzedUnitCoverageSummary = UnitCoverageSummary &
	Readonly<{
		analysis?: CoverageAnalysisMetadata;
	}>;

export const HYBRID_COVERED_THRESHOLD = 0.78;
export const HYBRID_PARTIAL_THRESHOLD = 0.42;

function clamp(value: number) {
	return Math.min(1, Math.max(0, value));
}

export function lexicalCoverageSignal(rank: number) {
	return clamp(rank / 0.9);
}

export function semanticCoverageSignal(similarity: number) {
	return clamp((similarity - 0.45) / 0.33);
}

export function scoreSemanticCoverageCandidate(candidate: SemanticCoverageCandidate) {
	const lexical = lexicalCoverageSignal(candidate.lexicalRank);
	const semantic = semanticCoverageSignal(candidate.semanticSimilarity);
	let score = Math.max(lexical * 0.94, semantic * 0.96, lexical * 0.55 + semantic * 0.52);

	if (candidate.verification) {
		const confidence = clamp(candidate.verification.confidence);
		if (candidate.verification.coverage === 'strong') {
			score = Math.max(score, 0.82 + confidence * 0.16);
		} else if (candidate.verification.coverage === 'partial') {
			score = Math.min(0.77, Math.max(score * 0.82, 0.44 + confidence * 0.28));
		} else {
			score *= 1 - confidence * 0.85;
		}
	}

	return clamp(score);
}

function candidateKey(candidate: SemanticCoverageCandidate) {
	return `${candidate.documentId}:${candidate.pageId}`;
}

export function classifySemanticTopicCoverage(
	topic: string,
	candidates: readonly SemanticCoverageCandidate[]
): TopicCoverage {
	const scored = [...candidates]
		.map((candidate) => ({ candidate, score: scoreSemanticCoverageCandidate(candidate) }))
		.sort((left, right) => right.score - left.score);
	const seen = new Set<string>();
	const evidence: Array<TopicCoverage['evidence'][number]> = [];
	let bestScore = 0;

	for (const item of scored) {
		const key = candidateKey(item.candidate);
		if (seen.has(key)) continue;
		seen.add(key);
		bestScore = Math.max(bestScore, item.score);
		if (evidence.length < MAX_EVIDENCE_PER_TOPIC && item.score >= HYBRID_PARTIAL_THRESHOLD * 0.6) {
			evidence.push(
				Object.freeze({
					pageId: item.candidate.pageId,
					documentId: item.candidate.documentId,
					documentTitle: item.candidate.documentTitle,
					notebookId: item.candidate.notebookId,
					notebookName: item.candidate.notebookName,
					pageNumber: item.candidate.pageNumber,
					excerpt: item.candidate.excerpt,
					rank: item.score
				})
			);
		}
	}

	const status: TopicCoverageStatus =
		bestScore >= HYBRID_COVERED_THRESHOLD
			? 'covered'
			: bestScore >= HYBRID_PARTIAL_THRESHOLD
				? 'partial'
				: 'missing';

	return Object.freeze({
		topic,
		status,
		strength: Math.round(bestScore * 100),
		evidence: Object.freeze(evidence)
	});
}

export function summarizeSemanticCoverage(
	topics: readonly TopicCoverage[],
	analysis: CoverageAnalysisMetadata
): AnalyzedUnitCoverageSummary {
	const summary = summarizeUnitCoverage(topics);
	return Object.freeze({ ...summary, analysis: Object.freeze({ ...analysis }) });
}
