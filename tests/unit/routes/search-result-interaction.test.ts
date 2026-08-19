import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchResultHref } from '../../../src/lib/search/search-result-presentation';

const source = readFileSync('src/lib/components/SearchDocumentCard.svelte', 'utf8');

describe('search result interaction states', () => {
	it('gives keyboard focus a clear visual emphasis', () => {
		expect(source).toContain('.document-result:focus-within');
	});

	it('limits hover-only emphasis to hover-capable precise pointers', () => {
		const mediaIndex = source.indexOf('@media (hover: hover) and (pointer: fine)');
		const hoverIndex = source.indexOf('.document-result:hover');

		expect(mediaIndex).toBeGreaterThanOrEqual(0);
		expect(hoverIndex).toBeGreaterThan(mediaIndex);
	});

	it('opens pure visual matches without inventing a textual highlight', () => {
		expect(searchResultHref('document-1', 3, 'visual', 'árvores urbanas')).toBe(
			'/documents/document-1/?page=3'
		);
		expect(searchResultHref('document-1', 3, 'semantic', 'árvores urbanas')).toBe(
			'/documents/document-1/?page=3'
		);
		expect(searchResultHref('document-1', 3, 'hybrid', 'árvores urbanas')).toBe(
			'/documents/document-1/?page=3&highlight=%C3%A1rvores%20urbanas'
		);
		expect(source).toContain("return 'Pela página'");
	});
});
