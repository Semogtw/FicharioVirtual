import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skeleton = readFileSync('src/lib/components/LoadingCollection.svelte', 'utf8');
const home = readFileSync('src/routes/+page.svelte', 'utf8');
const library = readFileSync('src/routes/library/+page.svelte', 'utf8');
const notebooks = readFileSync('src/routes/notebooks/+page.svelte', 'utf8');
const search = readFileSync('src/routes/search/+page.svelte', 'utf8');

describe('structural loading placeholders', () => {
	it('provides document, notebook and search geometries with accessible status text', () => {
		expect(skeleton).toContain("type LoadingVariant = 'documents' | 'notebooks' | 'search';");
		expect(skeleton).toContain('role="status"');
		expect(skeleton).toContain('aria-busy="true"');
		expect(skeleton).toContain('class="visually-hidden">{label}</span>');
	});

	it('uses subtle staged motion instead of a blocking spinner', () => {
		expect(skeleton).toContain('@keyframes skeleton-enter');
		expect(skeleton).toContain('@keyframes skeleton-sheen');
		expect(skeleton).toContain('calc(var(--skeleton-index) * 35ms)');
		expect(skeleton).not.toContain('spinner');
	});

	it('replaces plain initial loading text on the highest-traffic collection screens', () => {
		expect(home).toContain('<LoadingCollection count={6}');
		expect(library).toContain('<LoadingCollection label="Organizando seus documentos…"');
		expect(notebooks).toContain('<LoadingCollection variant="notebooks" count={4}');
		expect(search).toContain('<LoadingCollection variant="search" count={6}');
	});
});
