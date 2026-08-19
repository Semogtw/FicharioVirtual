import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/+layout.svelte';

describe('Drive workspace navigation', () => {
	it('keeps overview, pending changes, conflicts and explicit import discoverable', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('href="/drive/"');
		expect(source).toContain('href="/drive/jobs/"');
		expect(source).toContain('href="/drive/conflicts/"');
		expect(source).toContain('href="/import/drive/"');
		expect(source).toContain('Visão geral');
		expect(source).toContain('Pendências');
		expect(source).toContain('Conflitos');
		expect(source).toContain('Importar do Drive');
		expect(source).toContain("page.url.pathname.startsWith('/drive/jobs')");
		expect(source).toContain("page.url.pathname.startsWith('/drive/conflicts')");
		expect(source).not.toContain('/drive/migrate/');
		expect(source).not.toContain('Migrar legados');
	});
});
