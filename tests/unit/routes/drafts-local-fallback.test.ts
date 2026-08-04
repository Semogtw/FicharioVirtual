import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/review/drafts/+page.svelte', 'utf8');

describe('draft route local fallback', () => {
	it('keeps local drafts visible when remote locations cannot be resolved', () => {
		expect(source).toContain('let locationError = $state<string | null>(null);');
		expect(source).toContain('let locationsReady = $state(false);');
		expect(source).toContain('const localRows = Object.freeze(');
		expect(source).toContain('rows = localRows;');
		expect(source).toContain("locationError = 'Não foi possível localizar as páginas dos rascunhos.';");
		expect(source).toContain('{#if locationError}');
		expect(source).toContain('Tentar localizar novamente');
	});

	it('does not claim an unresolved page was deleted', () => {
		expect(source).toContain(
			"row.location?.documentTitle ?? (locationsReady ? 'Página não encontrada no servidor' : 'Localização indisponível')"
		);
		expect(source).toContain('{#if locationsReady}');
		expect(source).toContain('A localização desta página ainda não pôde ser confirmada.');
	});
});
