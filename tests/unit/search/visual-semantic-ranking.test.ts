import { describe, expect, it } from 'vitest';
import {
	compareMultimodalRanked,
	hybridReciprocalRankScore,
	multimodalReciprocalRankScore,
	type MultimodalRankingSignal
} from '../../../supabase/functions/_shared/semantic-ranking';
import { SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY } from '../../../supabase/functions/_shared/semantic-config';

type RankedSignal = MultimodalRankingSignal & { stableKey: string };

describe('visual semantic RRF benchmark fixtures', () => {
	it('preserves the previous score exactly when no visual signal exists', () => {
		const base = hybridReciprocalRankScore({
			lexicalRank: 2,
			semanticRank: 3,
			semanticSimilarity: 0.72
		});
		const multimodal = multimodalReciprocalRankScore({
			lexicalRank: 2,
			semanticRank: 3,
			semanticSimilarity: 0.72,
			visualRank: null,
			visualSimilarity: null
		});
		expect(multimodal).toBe(base);
	});

	it('keeps an exact lexical hit ahead of threshold-level visual-only evidence', () => {
		const lexical = multimodalReciprocalRankScore({
			lexicalRank: 1,
			semanticRank: null,
			visualRank: null
		});
		const visual = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: null,
			visualRank: 1,
			visualSimilarity: SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY
		});
		expect(lexical).toBeGreaterThan(visual);
	});

	it('keeps an exact lexical hit ahead of even a very strong visual decoy when visual is active', () => {
		const lexical: RankedSignal = {
			lexicalRank: 1,
			semanticRank: null,
			visualRank: null,
			visualSimilarity: null,
			stableKey: 'lexical'
		};
		const visual: RankedSignal = {
			lexicalRank: null,
			semanticRank: null,
			visualRank: 1,
			visualSimilarity: 0.99,
			stableKey: 'visual'
		};
		expect(compareMultimodalRanked(lexical, visual, { visualChannelActive: true })).toBeLessThan(0);
	});

	it('lets measured strong visual evidence beat a misleading semantic-only candidate', () => {
		const misleadingSemantic = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: 1,
			semanticSimilarity: 0.75,
			visualRank: null
		});
		const strongVisual = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: null,
			visualRank: 1,
			visualSimilarity: 0.421
		});
		expect(strongVisual).toBeGreaterThan(misleadingSemantic);
	});

	it('does not double-count weak text and visual agreement over a better visual candidate', () => {
		const misleadingCrossChannel = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: 1,
			semanticSimilarity: 0.7446,
			visualRank: 9,
			visualSimilarity: 0.36307
		});
		const expectedVisual = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: null,
			visualRank: 2,
			visualSimilarity: 0.419399619102481
		});
		expect(expectedVisual).toBeGreaterThan(misleadingCrossChannel);
	});

	it('gives a missed page a deterministic non-zero score from the visual channel', () => {
		const visual = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: null,
			visualRank: 2,
			visualSimilarity: 0.84
		});
		expect(visual).toBeGreaterThan(0);
	});

	it('rewards agreement between text and visual channels without additive double-counting', () => {
		const textOnly = multimodalReciprocalRankScore({
			lexicalRank: 5,
			semanticRank: 4,
			semanticSimilarity: 0.7,
			visualRank: null
		});
		const agreed = multimodalReciprocalRankScore({
			lexicalRank: 5,
			semanticRank: 4,
			semanticSimilarity: 0.7,
			visualRank: 3,
			visualSimilarity: 0.76
		});
		expect(agreed).toBeGreaterThan(textOnly);
	});
});
