import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/notebooks/+page.svelte', 'utf8');

describe('notebook creation errors', () => {
	it('does not hide an already loaded notebook list when creation fails', () => {
		expect(source).toContain('let loadError = $state<string | null>(null);');
		expect(source).toContain('let createError = $state<string | null>(null);');
		expect(source).toContain("createError = 'Não foi possível criar o caderno.';");
		expect(source).toContain('{#if createError}');
		expect(source).toContain('<p class="form-error" role="alert">{createError}</p>');
		expect(source).toContain('{#if loadError}');
		expect(source).not.toContain("error = 'Não foi possível criar o caderno.';");
	});
});
