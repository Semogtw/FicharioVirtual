import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('svelte.config.js', 'utf8');

describe('static SPA deep-route assets', () => {
	it('uses root-relative SvelteKit runtime assets', () => {
		expect(source).toContain("fallback: '200.html'");
		expect(source).toMatch(/paths:\s*\{\s*relative:\s*false\s*\}/m);
	});
});
