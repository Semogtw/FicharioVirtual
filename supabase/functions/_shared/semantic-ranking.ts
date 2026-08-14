import {
	SEMANTIC_RRF_BOTH_BONUS,
	SEMANTIC_RRF_K,
	SEMANTIC_RRF_LEXICAL_WEIGHT,
	SEMANTIC_RRF_VECTOR_WEIGHT,
	SEMANTIC_RRF_VISUAL_BONUS,
	SEMANTIC_RRF_VISUAL_WEIGHT
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
	const similarityTieBreak = Math.max(0, Math.min(1, signal.semanticSimilarity ?? 0)) * 0.0001;
	return lexical + semantic + both + similarityTieBreak;
}

/**
 * Adds the optional visual channel conservatively. With no visual rank the
 * score is bit-for-bit the existing two-channel score, which preserves the
 * previous ranking when visual enrichment is absent or disabled.
 */
export function multimodalReciprocalRankScore(signal: MultimodalRankingSignal) {
	const base = hybridReciprocalRankScore(signal);
	if (signal.visualRank === null) return base;
	const visual = reciprocalRank(signal.visualRank, SEMANTIC_RRF_VISUAL_WEIGHT);
	const crossChannelBonus =
		signal.lexicalRank !== null || signal.semanticRank !== null ? SEMANTIC_RRF_VISUAL_BONUS : 0;
	const visualTieBreak = Math.max(0, Math.min(1, signal.visualSimilarity ?? 0)) * 0.00002;
	return base + visual + crossChannelBonus + visualTieBreak;
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
