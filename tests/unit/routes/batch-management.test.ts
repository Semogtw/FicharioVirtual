import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('batch document management routes', () => {
	it('loads complete collections instead of invalid oversized pages', () => {
		for (const path of [
			'src/routes/library/organize/+page.svelte',
			'src/routes/library/tags/+page.svelte',
			'src/routes/notebooks/[id]/+page.svelte'
		]) {
			const source = read(path);
			expect(source).toContain('listAllDocuments');
			expect(source).not.toMatch(/listDocuments\([\s\S]{0,200}?limit:\s*(?:6[1-9]|[7-9]\d|\d{3,})/);
		}
	});

	it('prevents edits from changing context while a save is in flight', () => {
		const organization = read('src/routes/library/organize/+page.svelte');
		const tags = read('src/routes/library/tags/+page.svelte');

		expect(organization.match(/disabled=\{row\.saving\}/g)).toHaveLength(2);
		expect(tags).toContain('disabled={saving || loadingAssignments || pendingDocumentId !== null}');
	});
});
