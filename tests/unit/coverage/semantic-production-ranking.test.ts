import { describe, expect, it } from 'vitest';
import {
	SEMANTIC_COVERAGE_MIN_SIMILARITY,
	SEMANTIC_EMBEDDING_DIMENSIONS,
	SEMANTIC_EMBEDDING_MODEL,
	SEMANTIC_HNSW_EF_SEARCH,
	SEMANTIC_RRF_BOTH_BONUS,
	SEMANTIC_RRF_K,
	SEMANTIC_RRF_LEXICAL_WEIGHT,
	SEMANTIC_RRF_VECTOR_WEIGHT,
	SEMANTIC_SEARCH_MIN_SIMILARITY
} from '../../../supabase/functions/_shared/semantic-config';
import {
	compareHybridRanked,
	hybridReciprocalRankScore
} from '../../../supabase/functions/_shared/semantic-ranking';

type Candidate = {
	stableKey: string;
	lexicalRank: number | null;
	semanticRank: number | null;
	semanticSimilarity: number | null;
};

function order(candidates: Candidate[]) {
	return [...candidates].sort(compareHybridRanked).map((candidate) => candidate.stableKey);
}

describe('semantic production ranking calibration', () => {
	it('locks the first-deploy embedding and retrieval contract', () => {
		expect(SEMANTIC_EMBEDDING_MODEL).toBe('gemini-embedding-2');
		expect(SEMANTIC_EMBEDDING_DIMENSIONS).toBe(768);
		expect(SEMANTIC_SEARCH_MIN_SIMILARITY).toBe(0.46);
		expect(SEMANTIC_COVERAGE_MIN_SIMILARITY).toBe(0.5);
		expect(SEMANTIC_HNSW_EF_SEARCH).toBe(80);
	});

	it('keeps fusion weights explicit and balanced around semantic recall', () => {
		expect(SEMANTIC_RRF_K).toBe(28);
		expect(SEMANTIC_RRF_LEXICAL_WEIGHT).toBe(0.48);
		expect(SEMANTIC_RRF_VECTOR_WEIGHT).toBe(0.52);
		expect(SEMANTIC_RRF_BOTH_BONUS).toBe(0.012);
	});

	it('promotes a result supported by both retrieval channels over single-channel leaders', () => {
		expect(
		order([
			{ stableKey: 'lexical-only', lexicalRank: 1, semanticRank: null, semanticSimilarity: null },
			{ stableKey: 'semantic-only', lexicalRank: null, semanticRank: 1, semanticSimilarity: 0.83 },
			{ stableKey: 'both', lexicalRank: 3, semanticRank: 3, semanticSimilarity: 0.72 }
		])
	).toEqual(['both', 'semantic-only', 'lexical-only']);
	});

	it('uses similarity only as a small tie-break instead of mixing raw cosine with FTS rank', () => {
		const low = hybridReciprocalRankScore({
			lexicalRank: null,
			semanticRank: 4,
			semanticSimilarity: 0.55
		});
		const high = hybridReciprocalRankScore({
			lexicalRank: null,
			semanticRank: 4,
			semanticSimilarity: 0.9
		});
		expect(high).toBeGreaterThan(low);
		expect(high - low).toBeLessThan(0.00004);
	});

	it('is deterministic when retrieval signals tie exactly', () => {
		expect(
		order([
			{ stableKey: 'b-page', lexicalRank: 2, semanticRank: 2, semanticSimilarity: 0.7 },
			{ stableKey: 'a-page', lexicalRank: 2, semanticRank: 2, semanticSimilarity: 0.7 }
		])
	).toEqual(['a-page', 'b-page']);
	});
});
