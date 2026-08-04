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
		expect(notebookRoute).toContain('initializeRequests.next()');
		expect(notebookRoute).toContain('initializeRequests.isCurrent(version)');
		expect(notebookRoute).not.toContain('onMount(() =>');
	});

	it('remounts the correction editor when the selected page changes', () => {
		const documentRoute = read('src/routes/documents/[id]/+page.svelte');

		expect(documentRoute).toMatch(
			/\{#key selectedPage\.id\}[\s\S]*<CorrectionEditor page=\{selectedPage\}[\s\S]*\{\/key\}/
		);
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

	it('ignores stale review pages after a newer queue reload', () => {
		const reviewRoute = read('src/routes/review/+page.svelte');

		expect(reviewRoute).toContain(
			"import { RequestVersion } from '$lib/services/request-version';"
		);
		expect(reviewRoute).toContain('const loadRequests = new RequestVersion();');
		expect(reviewRoute).toContain('loadRequests.next()');
		expect(reviewRoute).toContain('loadRequests.isCurrent(version)');
		expect(reviewRoute).toMatch(
			/const offset = reset \? 0 : items\.length;[\s\S]*if \(!loadRequests\.isCurrent\(version\)\) return;[\s\S]*items = reset/
		);
	});

	it('offers OCR retry only for states accepted by claim_ocr_job', () => {
		const reviewRoute = read('src/routes/review/+page.svelte');

		expect(reviewRoute).toContain("{#if ['retryable', 'blocked_quota'].includes(item.pageStatus)}");
		expect(reviewRoute).not.toContain("item.pageStatus !== 'needs_review'");
	});
});
