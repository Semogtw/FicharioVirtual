import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/search/+page.svelte', 'utf8');

describe('search notebook filter loading', () => {
	it('keeps text search available when notebook options fail independently', () => {
		expect(source).toContain('const notebookRequests = new RequestVersion();');
		expect(source).toContain('let notebookError = $state<string | null>(null);');
		expect(source).toContain('async function loadNotebookOptions');
		expect(source).toContain('notebookRequests.isCurrent(version)');
		expect(source).not.toContain('.catch(() => undefined)');
		expect(source).toContain('Não foi possível carregar os cadernos para o filtro.');
		expect(source).toContain('onclick={() => void loadNotebookOptions()}');
		expect(source).toContain('disabled={notebookLoading}');
	});

	it('invalidates notebook loads with the search request on destroy', () => {
		expect(source).toContain('notebookRequests.next();');
		expect(source).toContain('onDestroy(() => {');
	});
});
