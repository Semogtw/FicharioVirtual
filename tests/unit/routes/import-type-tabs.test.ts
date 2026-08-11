import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/import/+layout.svelte', 'utf8');

describe('import type tabs', () => {
	it('keeps image and PDF import actions clearly separate', () => {
		expect(source).toContain('Imagens e câmera');
		expect(source).toContain('JPG, PNG ou WebP');
		expect(source).toContain('PDFs e arquivos');
		expect(source).toContain('Selecionar PDF');
	});

	it('expands the picker tabs across narrow mobile screens', () => {
		expect(source).toContain('@media (max-width: 600px)');
		expect(source).toContain('width: 100%');
		expect(source).toContain('flex: 1');
	});
});
