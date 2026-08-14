import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repositoryRoot), 'utf8');

describe('import notebook query selection', () => {
	it('reacts to the notebook query and keeps the URL aligned in the unified import page', () => {
		const source = read('src/lib/components/UnifiedImportPage.svelte');
		expect(source).toContain("import { replaceState } from '$app/navigation';");
		expect(source).toContain("import { page } from '$app/state';");
		expect(source).toContain('parseRequestedNotebookId(page.url.searchParams)');
		expect(source).toContain('resolveImportNotebookSelection(');
		expect(source).toContain('let notebookOptionsReady = $state(false);');
		expect(source).toContain('async function loadNotebookOptions');
		expect(source).toContain('notebookRequests.isCurrent(version)');
		expect(source).toContain('if (notebookSelection.requiresResolution)');
		expect(source).toContain('importSelectionUrl(page.url, notebookId)');
		expect(source).toContain('onDestroy(() =>');
	});

	it('keeps fast file selections until a requested notebook finishes resolving', () => {
		const source = read('src/lib/components/UnifiedImportPage.svelte');
		expect(source).toContain('let pendingSelections = $state<PendingSelection[]>([]);');
		expect(source).toContain('...pendingSelections,');
		expect(source).toContain('{ files: [...files], draftImages: options.draftImages ?? false }');
		expect(source).toContain('Confirmando o caderno antes de adicionar os arquivos…');
		expect(source).toContain('const waiting = pendingSelections;');
		expect(source).toContain('pendingSelections = [];');
		expect(source).toContain(
			'const resolved = resolveImportNotebookSelection(requestedNotebookId, items, true);'
		);
		expect(source).toContain('for (const pending of waiting)');
		expect(source).toContain(
			'enqueue(pending.files, resolved.notebookId, { draftImages: pending.draftImages });'
		);
	});

	it.each(['src/routes/import/+page.svelte', 'src/routes/import/pdf/+page.svelte'])(
		'%s delegates selection behavior to the unified import page',
		(path) => expect(read(path)).toContain('$lib/components/UnifiedImportPage.svelte')
	);

	it('preserves the selected notebook when switching import tabs', () => {
		const source = read('src/routes/import/+layout.svelte');
		expect(source).toContain('parseRequestedNotebookId(page.url.searchParams)');
		expect(source).toContain("importHref('/import/', requestedNotebookId)");
		expect(source).toContain("importHref('/import/pdf/', requestedNotebookId)");
	});
});
