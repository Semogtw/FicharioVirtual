import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/notebooks/[id]/+page.svelte', 'utf8');

describe('notebook detail partial loading', () => {
	it('keeps notebook metadata available when document loading fails', () => {
		expect(source).not.toContain('await Promise.all([');
		expect(source).toContain('const documentRequests = new RequestVersion();');
		expect(source).toContain('let documentsLoading = $state(false);');
		expect(source).toContain('let documentsError = $state<string | null>(null);');
		expect(source).toContain('async function loadDocuments');
		expect(source).toContain(
			"documentsError = 'Não foi possível carregar os documentos deste caderno.';"
		);
	});

	it('offers an independent retry without hiding the notebook header', () => {
		expect(source).toContain('{#if documentsError}');
		expect(source).toContain('Tentar carregar documentos');
		expect(source).toContain('onclick={() => notebook && void loadDocuments(notebook.id)}');
		expect(source).toContain('{:else if documentsLoading}');
	});

	it('invalidates metadata and document requests when leaving the route', () => {
		expect(source).toContain("import { onDestroy } from 'svelte';");
		expect(source).toContain('notebookRequests.next();');
		expect(source).toContain('documentRequests.next();');
	});
});
