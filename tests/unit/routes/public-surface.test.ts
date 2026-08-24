import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootLayout = readFileSync('src/routes/+layout.ts', 'utf8');
const rootShell = readFileSync('src/routes/+layout.svelte', 'utf8');
const home = readFileSync('src/routes/+page.svelte', 'utf8');
const landing = readFileSync('src/lib/components/PublicLanding.svelte', 'utf8');
const privacy = readFileSync('src/routes/privacy/+page.svelte', 'utf8');
const terms = readFileSync('src/routes/terms/+page.svelte', 'utf8');

describe('public product surface', () => {
	it('allows the anonymous landing and legal pages without opening the application', () => {
		expect(rootLayout).toMatch(
			/const publicRoutePrefixes = \['\/', '\/login', '\/privacy', '\/terms'\]/
		);
		expect(rootLayout).toContain('const isPublicRoute = publicRoutePrefixes.some');
		expect(rootLayout).toContain('if (session === null && !isPublicRoute) {');
		expect(rootLayout).toContain('if (session !== null && isLoginRoute) {');
		expect(rootShell).toContain("page.url.pathname === '/'");
		expect(rootShell).toContain("page.url.pathname.startsWith('/privacy')");
	});

	it('renders the authenticated dashboard only when a session exists', () => {
		expect(home).toContain("import PublicLanding from '$lib/components/PublicLanding.svelte';");
		expect(home).toContain('page.data.session === null');
		expect(home).toContain('<PublicLanding />');
		expect(home).toContain('if (page.data.session === null) return;');
	});

	it('presents honest signup, product, source, and legal entry points', () => {
		expect(landing).toContain('Seu arquivo não cabe numa pasta.');
		expect(landing).toContain('Criar conta');
		expect(landing).toContain('Buscar por texto, erro de escrita ou significado.');
		expect(landing).toContain('https://github.com/Semogtw/FicharioVirtual');
		expect(landing).toContain('href="/privacy/"');
		expect(landing).toContain('href="/terms/"');
	});

	it('publishes privacy and terms pages with the public data boundary', () => {
		expect(privacy).toContain('Privacidade');
		expect(privacy).toContain('Google Drive');
		expect(privacy).toContain('exclusão da conta');
		expect(terms).toContain('Termos de uso');
		expect(terms).toContain('uso experimental');
		expect(terms).toContain('sem cobrança');
	});
});
