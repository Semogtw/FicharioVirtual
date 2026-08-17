import { describe, expect, it } from 'vitest';
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

	it('keeps fuzzy and semantic recall open when no strong lexical match exists', () => {
		const lexical = [{ document_id: 'fuzzy', rank: 1.24 }];
		const policy = hybridPrecisionPolicy(lexical);
		const semantic = [
			{ document_id: 'paraphrase', semantic_similarity: 0.72 },
			{ document_id: 'fuzzy', semantic_similarity: 0.55 }
		];

		expect(policy.restricted).toBe(false);
		expect(applyHybridPrecision(lexical, policy)).toEqual(lexical);
		expect(applyHybridPrecision(semantic, policy)).toEqual(semantic);
	});

	it('does not treat ordinary fuzzy trigram evidence as a precision lock', () => {
		const policy = hybridPrecisionPolicy([
			{ document_id: 'near-match', rank: STRONG_LEXICAL_RANK_MIN - 0.0001 }
		]);
		expect(policy.restricted).toBe(false);
	});
});
