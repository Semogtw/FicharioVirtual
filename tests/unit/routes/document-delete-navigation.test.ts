import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/documents/[id]/+page.svelte', 'utf8');

describe('document deletion completion', () => {
	it('does not report a completed deletion as a deletion failure when navigation fails', () => {
		expect(source).toContain('let deleted = $state(false);');
		expect(source).toMatch(
			/await deleteDocument\(documentId\);[\s\S]*deleted = true;[\s\S]*detail = null;[\s\S]*try \{[\s\S]*await goto\('\/library\/'\);/
		);
		expect(source).toContain(
			"error = 'Documento excluído, mas não foi possível voltar à biblioteca.';"
		);
		expect(source).toContain('{:else if deleted}');
		expect(source).toContain('O documento foi excluído.');
		expect(source).toContain('href="/library/"');
	});

	it('resets deletion completion when a different document route is opened', () => {
		expect(source).toMatch(/\$effect\(\(\) => \{[\s\S]*deleted = false;/);
	});
});
