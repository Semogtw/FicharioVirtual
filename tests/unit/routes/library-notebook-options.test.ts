import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/library/+page.svelte', 'utf8');

describe('library notebook filter loading', () => {
	it('keeps documents available when notebook options fail independently', () => {
		expect(source).toContain('const notebookRequests = new RequestVersion();');
		expect(source).toContain('let notebookError = $state<string | null>(null);');
		expect(source).toContain('async function loadNotebookOptions');
		expect(source).toContain('notebookRequests.isCurrent(version)');
		expect(source).not.toContain('listNotebooks().catch(() => [] as const)');
		expect(source).toContain('Não foi possível carregar os cadernos para o filtro.');
		expect(source).toContain('onclick={() => void loadNotebookOptions()}');
	});

	it('invalidates document and notebook loads when the route is destroyed', () => {
		expect(source).toContain("import { onDestroy, onMount } from 'svelte';");
		expect(source).toContain('requests.next();');
		expect(source).toContain('notebookRequests.next();');
		expect(source).toContain('onDestroy(() => {');
	});
});
