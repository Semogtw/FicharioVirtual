import { describe, expect, it } from 'vitest';
import {
	hybridReciprocalRankScore,
	multimodalReciprocalRankScore
} from '../../../supabase/functions/_shared/semantic-ranking';

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

	it('does not let a visual-only result displace a strong lexical hit', () => {
		const lexical = multimodalReciprocalRankScore({
			lexicalRank: 1,
			semanticRank: null,
			visualRank: null
		});
		const visual = multimodalReciprocalRankScore({
			lexicalRank: null,
			semanticRank: null,
			visualRank: 1,
			visualSimilarity: 0.91
		});
		expect(lexical).toBeGreaterThan(visual);
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

	it('rewards agreement between text and visual channels without raw-score mixing', () => {
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
