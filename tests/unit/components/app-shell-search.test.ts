import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/AppShell.svelte', 'utf8');

describe('AppShell global search', () => {
	it('opens the real search route and reflects its query in the top field', () => {
		expect(source).toContain("import { page } from '$app/state';");
		expect(source).toContain("void goto(`/search/?q=${encodeURIComponent(query)}`);");
		expect(source).toContain(
			"let searchQuery = $derived(page.url.pathname.startsWith('/search') ? (page.url.searchParams.get('q')?.slice(0, 200) ?? '') : '');"
		);
		expect(source).toContain('<TopSearch initialValue={searchQuery} onSearch={search} />');
		expect(source).not.toContain('/library/?q=');
	});
});
