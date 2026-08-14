import { describe, expect, it } from 'vitest';
import {
	SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY
} from '../../../supabase/functions/_shared/semantic-config';

// Real staging evidence from the 2026-08-14 15-document corpus. The visual
// channel is intentionally calibrated from cross-modal scores instead of
// reusing the higher text-to-text semantic threshold.
const relevantVisualScores = [
	0.419399619102481,
	0.421000880628851,
	0.466583490371704,
	0.447303798634041,
	0.411808515298875,
	0.437095075845718,
	0.428031576515185,
	0.439406387735175,
	0.451670140028,
	0.361665687660319,
	0.44657427072525,
	0.459756252751127,
	0.429441690444946,
	0.407780170440674
] as const;

const strongestNegativeCandidates = [
	0.349310368299484,
	0.325093984603882,
	0.332660208125717
] as const;

describe('visual similarity threshold calibration', () => {
	it('keeps the measured relevant range while rejecting the measured negative range', () => {
		const weakestRelevant = Math.min(...relevantVisualScores);
		const strongestNegative = Math.max(...strongestNegativeCandidates);

		expect(strongestNegative).toBeLessThan(SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY);
		expect(SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY).toBeLessThanOrEqual(weakestRelevant);
	});

	it('retains a non-zero separation margin from the strongest measured negative', () => {
		const strongestNegative = Math.max(...strongestNegativeCandidates);
		expect(SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY - strongestNegative).toBeGreaterThan(0.01);
	});
});
