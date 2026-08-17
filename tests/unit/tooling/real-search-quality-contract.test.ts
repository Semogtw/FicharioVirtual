import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/checks/check-real-search-quality.mjs', 'utf8');

describe('real semantic search quality contract', () => {
	it('allows legitimate shared-corpus results before the imported fixture', () => {
		expect(source).toContain('if (report.quality.semantic.recallAt3 !== 1)');
		expect(source).toContain('pre-existing document with the exact natural-language wording');
		expect(source).not.toContain(
			'if (report.quality.semantic.recallAt1 !== 1 || report.quality.semantic.recallAt3 !== 1)'
		);
	});
});
