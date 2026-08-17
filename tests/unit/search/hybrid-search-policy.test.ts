import { describe, expect, it } from 'vitest';
import { SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY } from '../../../supabase/functions/_shared/semantic-config';
import {
	applyHybridPrecision,
	hybridPrecisionPolicy,
	STRONG_LEXICAL_RANK_MIN
} from '../../../supabase/functions/_shared/hybrid-search-policy';

describe('hybrid search precision policy', () => {
	it('locks candidate recall to documents with strong lexical evidence', () => {
		const lexical = [
			{ document_id: 'exact', rank: STRONG_LEXICAL_RANK_MIN },
			{ document_id: 'fuzzy', rank: 1.24 }
		];
		const policy = hybridPrecisionPolicy(lexical);

		expect(policy.restricted).toBe(true);
		expect(applyHybridPrecision(lexical, policy)).toEqual([lexical[0]]);
		expect(
			applyHybridPrecision(
				[
					{ document_id: 'semantic-noise', semantic_similarity: 0.68 },
					{ document_id: 'exact', semantic_similarity: 0.61 }
				],
				policy
			)
		).toEqual([{ document_id: 'exact', semantic_similarity: 0.61 }]);
	});

	it('keeps lexical recall open while requiring confidence for semantic-only candidates', () => {
		const lexical = [{ document_id: 'fuzzy', rank: 1.24 }];
		const policy = hybridPrecisionPolicy(lexical);
		const semantic = [
			{
				document_id: 'paraphrase',
				semantic_similarity: SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY + 0.08
			},
			{
				document_id: 'semantic-noise',
				semantic_similarity: SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY - 0.01
			}
		];

		expect(policy.restricted).toBe(false);
		expect(applyHybridPrecision(lexical, policy)).toEqual(lexical);
		expect(applyHybridPrecision(semantic, policy)).toEqual([semantic[0]]);
	});

	it('accepts the standalone semantic floor exactly', () => {
		const policy = hybridPrecisionPolicy([]);
		const semantic = [
			{
				document_id: 'boundary',
				semantic_similarity: SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY
			},
			{
				document_id: 'below',
				semantic_similarity: SEMANTIC_SEARCH_STANDALONE_MIN_SIMILARITY - Number.EPSILON
			}
		];
		expect(applyHybridPrecision(semantic, policy)).toEqual([semantic[0]]);
	});

	it('does not apply the textual semantic floor to visual candidates', () => {
		const policy = hybridPrecisionPolicy([]);
		const visual = [{ document_id: 'visual', visual_similarity: 0.36 }];
		expect(applyHybridPrecision(visual, policy)).toEqual(visual);
	});

	it('does not treat ordinary fuzzy trigram evidence as a precision lock', () => {
		const policy = hybridPrecisionPolicy([
			{ document_id: 'near-match', rank: STRONG_LEXICAL_RANK_MIN - 0.0001 }
		]);
		expect(policy.restricted).toBe(false);
	});
});
