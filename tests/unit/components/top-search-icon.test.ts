import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/TopSearch.svelte', 'utf8');

describe('top search submit affordance', () => {
	it('uses a stable SVG icon on narrow screens without pseudo-element glyphs', () => {
		expect(source).toContain('class="submit-icon"');
		expect(source).toContain('class="submit-label"');
		expect(source).not.toContain("content: '↵'");
		expect(source).not.toContain('font-size: 0');
	});
});
