import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
		expect(source).toContain("result.matchMode === 'visual'");
		expect(source).toContain("? `/documents/${result.documentId}/?page=${result.pageNumber}`");
		expect(source).toContain("result.matchMode === 'visual' ? '' : query");
		expect(source).toContain("return 'Pela página'");
	});
});
