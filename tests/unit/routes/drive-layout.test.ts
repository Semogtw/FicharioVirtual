import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/+layout.svelte';

describe('Drive workspace navigation', () => {
	it('links recovery and explicit Picker import without legacy migration UI', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('href="/drive/"');
		expect(source).toContain('href="/import/drive/"');
		expect(source).toContain('Recuperação');
		expect(source).toContain('Importar do Drive');
		expect(source).not.toContain('/drive/migrate/');
		expect(source).not.toContain('Migrar legados');
	});
});
