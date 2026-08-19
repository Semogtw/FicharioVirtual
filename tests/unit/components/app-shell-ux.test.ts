import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellSource = readFileSync('src/lib/components/AppShell.svelte', 'utf8');

describe('AppShell UX affordances', () => {
	it('does not render a second global search field on the dedicated search route', () => {
		expect(shellSource).toContain(
			"let searchRoute = $derived(page.url.pathname.startsWith('/search'))"
		);
		expect(shellSource).toContain('{#if searchRoute}');
		expect(shellSource).toContain('<div class="topbar-spacer" aria-hidden="true"></div>');
		expect(shellSource).toContain('<TopSearch initialValue={searchQuery} onSearch={search} />');
	});

	it('uses a truthful settings affordance instead of a fake avatar', () => {
		expect(shellSource).toContain('aria-label="Abrir configurações"');
		expect(shellSource).toContain('<NavigationIcon name="settings" />');
		expect(shellSource).not.toContain('aria-label="Abrir configurações">A</a>');
	});
});
