import {
	SEMANTIC_RRF_BOTH_BONUS,
	SEMANTIC_RRF_K,
	SEMANTIC_RRF_LEXICAL_WEIGHT,
	SEMANTIC_RRF_VECTOR_WEIGHT,
	SEMANTIC_RRF_VISUAL_BONUS,
	SEMANTIC_RRF_VISUAL_CONFIDENCE_WEIGHT,
	SEMANTIC_RRF_VISUAL_WEIGHT,
	SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY
} from './semantic-config.ts';

export type HybridRankingSignal = Readonly<{
	lexicalRank: number | null;
	semanticRank: number | null;
	semanticSimilarity?: number | null;
}>;

export type MultimodalRankingSignal = HybridRankingSignal &
	Readonly<{
		visualRank: number | null;
		visualSimilarity?: number | null;
	}>;

function reciprocalRank(rank: number | null, weight: number) {
	if (rank === null || !Number.isFinite(rank) || rank < 1) return 0;
	return weight / (SEMANTIC_RRF_K + rank);
}

function boundedSimilarity(value: number | null | undefined) {
	return Math.max(0, Math.min(1, value ?? 0));
}

/**
 * Reciprocal-rank fusion keeps FTS/trigram ranks and cosine similarities on
 * separate scales. That makes the production ranking much less sensitive to
 * provider/model score drift than mixing raw scores directly.
 */
export function hybridReciprocalRankScore(signal: HybridRankingSignal) {
	const lexical = reciprocalRank(signal.lexicalRank, SEMANTIC_RRF_LEXICAL_WEIGHT);
	const semantic = reciprocalRank(signal.semanticRank, SEMANTIC_RRF_VECTOR_WEIGHT);
	const both =
		signal.lexicalRank !== null && signal.semanticRank !== null ? SEMANTIC_RRF_BOTH_BONUS : 0;
	const similarityTieBreak = boundedSimilarity(signal.semanticSimilarity) * 0.0001;
	return lexical + semantic + both + similarityTieBreak;
}

/**
 * Adds the optional visual channel without double-counting correlated OCR and
 * image evidence. A page that already ranks textually receives the stronger
 * of its textual or visual scores plus a small corroboration bonus. Pure visual
 * pages keep the full visual score. The similarity margin above the calibrated
 * cross-modal floor is bounded and only supplies confidence inside the visual
 * channel; it never rescues a candidate that failed the retrieval threshold.
 */
export function multimodalReciprocalRankScore(signal: MultimodalRankingSignal) {
	const base = hybridReciprocalRankScore(signal);
	if (signal.visualRank === null) return base;

	const similarity = boundedSimilarity(signal.visualSimilarity);
	const confidence =
		Math.max(0, similarity - SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY) *
		SEMANTIC_RRF_VISUAL_CONFIDENCE_WEIGHT;
	const visual =
		reciprocalRank(signal.visualRank, SEMANTIC_RRF_VISUAL_WEIGHT) +
		confidence +
		similarity * 0.00002;
	const hasTextSignal = signal.lexicalRank !== null || signal.semanticRank !== null;
	if (!hasTextSignal) return visual;
	return Math.max(base, visual) + SEMANTIC_RRF_VISUAL_BONUS;
}

export function compareHybridRanked<T extends HybridRankingSignal & { stableKey: string }>(
	a: T,
	b: T
) {
	const scoreDelta = hybridReciprocalRankScore(b) - hybridReciprocalRankScore(a);
	if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
	return a.stableKey.localeCompare(b.stableKey);
}

export function compareMultimodalRanked<T extends MultimodalRankingSignal & { stableKey: string }>(
	a: T,
	b: T
) {
	const scoreDelta = multimodalReciprocalRankScore(b) - multimodalReciprocalRankScore(a);
	if (Math.abs(scoreDelta) > Number.EPSILON) return scoreDelta;
	return a.stableKey.localeCompare(b.stableKey);
}
