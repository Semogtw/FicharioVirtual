import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/search/+page.svelte', 'utf8');

describe('search result interaction states', () => {
	it('gives keyboard focus the same visual emphasis as pointer hover', () => {
		expect(source).toContain('li:focus-within');
	});

	it('limits hover-only emphasis to hover-capable precise pointers', () => {
		const mediaIndex = source.indexOf('@media (hover: hover) and (pointer: fine)');
		const hoverIndex = source.indexOf('li:hover');

		expect(mediaIndex).toBeGreaterThanOrEqual(0);
		expect(hoverIndex).toBeGreaterThan(mediaIndex);
	});
});
