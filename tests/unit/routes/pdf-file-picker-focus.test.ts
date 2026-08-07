import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/import/pdf/+page.svelte', 'utf8');

describe('PDF import file picker focus', () => {
	it('surfaces keyboard focus on the visible PDF picker', () => {
		expect(source).toContain('.file-button:focus-within');
		expect(source).toContain('outline: 0.1875rem solid var(--focus)');
		expect(source).toContain('outline-offset: 0.1875rem');
	});
});
