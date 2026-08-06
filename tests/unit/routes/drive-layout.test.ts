import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/+layout.svelte';

describe('Drive workspace navigation', () => {
	it('links recovery, legacy migration and explicit Picker import', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('href="/drive/"');
		expect(source).toContain('href="/drive/migrate/"');
		expect(source).toContain('href="/import/drive/"');
		expect(source).toContain('Recuperação');
		expect(source).toContain('Migrar legados');
		expect(source).toContain('Importar do Drive');
	});
});
