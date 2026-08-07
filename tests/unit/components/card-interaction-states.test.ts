import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const documentCard = readFileSync('src/lib/components/DocumentCard.svelte', 'utf8');
const notebookCard = readFileSync('src/lib/components/NotebookCard.svelte', 'utf8');

describe('card interaction states', () => {
	it.each([
		['DocumentCard', documentCard, '.document-card:focus-within'],
		['NotebookCard', notebookCard, '.notebook-card:focus-within']
	])('%s gives keyboard focus the raised-card affordance', (_name, source, selector) => {
		expect(source).toContain(selector);
	});

	it.each([
		['DocumentCard', documentCard],
		['NotebookCard', notebookCard]
	])('%s limits hover-only movement to hover-capable pointers', (_name, source) => {
		expect(source).toContain('@media (hover: hover) and (pointer: fine)');
	});
});
