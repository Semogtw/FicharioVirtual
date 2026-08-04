import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('import notebook query selection', () => {
	it.each(['src/routes/import/+page.svelte', 'src/routes/import/pdf/+page.svelte'])(
		'reacts to the notebook query and keeps the URL aligned in %s',
		(path) => {
			const source = read(path);
			expect(source).toContain("import { replaceState } from '$app/navigation';");
			expect(source).toContain("import { page } from '$app/state';");
			expect(source).toContain('parseRequestedNotebookId(page.url.searchParams)');
			expect(source).toContain('resolveImportNotebookSelection(');
			expect(source).toContain('let notebookOptionsReady = $state(false);');
			expect(source).toContain('let notebookError = $state<string | null>(null);');
			expect(source).toContain('async function loadNotebookOptions');
			expect(source).toContain('notebookRequests.isCurrent(version)');
			expect(source).toContain('onclick={() => void loadNotebookOptions()}');
			expect(source).toContain('if (notebookSelection.requiresResolution)');
			expect(source).toContain('O caderno solicitado precisa ser confirmado antes da importação.');
			expect(source).not.toContain('.catch(() => undefined)');
			expect(source).toContain('replaceState(url, page.state)');
			expect(source).not.toContain('onMount(() =>');
			expect(source).toContain('onDestroy(() =>');
		}
	);

	it('preserves the selected notebook when switching import tabs', () => {
		const source = read('src/routes/import/+layout.svelte');
		expect(source).toContain('parseRequestedNotebookId(page.url.searchParams)');
		expect(source).toContain("importHref('/import/', requestedNotebookId)");
		expect(source).toContain("importHref('/import/pdf/', requestedNotebookId)");
	});
});
