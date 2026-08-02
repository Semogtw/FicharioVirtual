import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('async route safety', () => {
	it('invalidates in-flight search results when the query is cleared', () => {
		const searchRoute = read('src/routes/search/+page.svelte');

		expect(searchRoute).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(searchRoute).toContain('requests.next();');
		expect(searchRoute).toContain('requests.isCurrent(version)');
		expect(searchRoute).toMatch(
			/if \(!requests\.isCurrent\(version\)\) return;[\s\S]*controller\?\.abort\(\)/
		);
	});

	it('remounts the correction editor when the selected page changes', () => {
		const documentRoute = read('src/routes/documents/[id]/+page.svelte');

		expect(documentRoute).toMatch(
			/\{#key selectedPage\.id\}[\s\S]*<CorrectionEditor page=\{selectedPage\}[\s\S]*\{\/key\}/
		);
	});

	it('offers OCR retry only for states accepted by claim_ocr_job', () => {
		const reviewRoute = read('src/routes/review/+page.svelte');

		expect(reviewRoute).toContain(
			"{#if ['retryable', 'blocked_quota'].includes(item.pageStatus)}"
		);
		expect(reviewRoute).not.toContain("item.pageStatus !== 'needs_review'");
	});
});
