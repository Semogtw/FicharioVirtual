import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('async route safety', () => {
	it('reacts to search query URL changes without keeping stale results', () => {
		const searchRoute = read('src/routes/search/+page.svelte');

		expect(searchRoute).toContain('$effect(() => {');
		expect(searchRoute).toContain(
			"const routeQuery = page.url.searchParams.get('q')?.slice(0, 200) ?? '';"
		);
		expect(searchRoute).toContain('query = routeQuery;');
		expect(searchRoute).toContain('void run(true);');
		expect(searchRoute).not.toContain('onMount(() =>');
	});

	it('invalidates in-flight search results when the query is cleared', () => {
		const searchRoute = read('src/routes/search/+page.svelte');

		expect(searchRoute).toContain(
			"import { RequestVersion } from '$lib/services/request-version';"
		);
		expect(searchRoute).toContain('requests.next();');
		expect(searchRoute).toContain('requests.isCurrent(version)');
		expect(searchRoute).toMatch(
			/if \(!requests\.isCurrent\(version\)\) return;[\s\S]*controller\?\.abort\(\)/
		);
	});

	it('reloads document details when the route parameter changes and ignores stale responses', () => {
		const documentRoute = read('src/routes/documents/[id]/+page.svelte');

		expect(documentRoute).toContain(
			"import { RequestVersion } from '$lib/services/request-version';"
		);
		expect(documentRoute).toContain('$effect(() => {');
		expect(documentRoute).toContain('const documentId = page.params.id;');
		expect(documentRoute).toContain('refreshRequests.next()');
		expect(documentRoute).toContain('refreshRequests.isCurrent(version)');
		expect(documentRoute).not.toContain('onMount(() =>');
	});

	it('reloads notebook details when the route parameter changes and ignores stale responses', () => {
		const notebookRoute = read('src/routes/notebooks/[id]/+page.svelte');

		expect(notebookRoute).toContain(
			"import { RequestVersion } from '$lib/services/request-version';"
		);
		expect(notebookRoute).toContain('$effect(() => {');
		expect(notebookRoute).toContain('const notebookId = page.params.id;');
		expect(notebookRoute).toContain('notebookRequests.next()');
		expect(notebookRoute).toContain('notebookRequests.isCurrent(version)');
		expect(notebookRoute).not.toContain('onMount(() =>');
	});

	it('does not let an older notebook refresh hide a newly created notebook', () => {
		const notebooksRoute = read('src/routes/notebooks/+page.svelte');

		expect(notebooksRoute).toContain(
			"import { RequestVersion } from '$lib/services/request-version';"
		);
		expect(notebooksRoute).toContain('const refreshRequests = new RequestVersion();');
		expect(notebooksRoute).toContain('refreshRequests.isCurrent(version)');
		expect(notebooksRoute).toMatch(
			/const notebook = await createNotebook[\s\S]*await refresh\(\);/
		);
	});
});
