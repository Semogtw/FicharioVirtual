import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/notebooks/[id]/+page.svelte', 'utf8');

describe('notebook detail metadata recovery', () => {
	it('offers a safe retry after a transient notebook metadata failure', () => {
		expect(source).toContain('function retryInitialize()');
		expect(source).toContain('const notebookId = page.params.id;');
		expect(source).toContain('if (notebookId) void initialize(notebookId);');
		expect(source).toContain('<p>{error}</p>');
		expect(source).toContain('onclick={retryInitialize}');
		expect(source).toContain('Tentar novamente');
	});
});
