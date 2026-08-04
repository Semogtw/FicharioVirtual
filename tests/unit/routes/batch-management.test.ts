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

	it('blocks tag creation until the complete workspace has loaded', () => {
		const tags = read('src/routes/library/tags/+page.svelte');

		expect(tags).toContain('let initialized = $state(false);');
		expect(tags).toContain('if (!initialized || saving || !newTagName.trim()) return;');
		expect(tags).toContain('disabled={!initialized || saving || !newTagName.trim()}');
		expect(tags).toContain('onclick={() => void initialize()}');
	});

	it('ignores stale tag assignments and snapshots the mutation target', () => {
		const tags = read('src/routes/library/tags/+page.svelte');

		expect(tags).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(tags).toContain('const assignmentRequests = new RequestVersion();');
		expect(tags).toContain('assignmentRequests.isCurrent(version)');
		expect(tags).toContain('activeTagId !== tagId');
		expect(tags).toContain('const tagId = activeTag.id;');
		expect(tags).toContain('await setTagMembership(tagId, documentId, assigned);');
		expect(tags).toContain('tag.id === tagId');
	});

	it('blocks tag membership edits until assignments load successfully', () => {
		const tags = read('src/routes/library/tags/+page.svelte');

		expect(tags).toContain('let assignmentsReady = $state(false);');
		expect(tags).toContain('let assignmentError = $state<string | null>(null);');
		expect(tags).toContain('if (!activeTag || !assignmentsReady || pendingDocumentId) return;');
		expect(tags).toContain('disabled={!assignmentsReady || pendingDocumentId !== null}');
		expect(tags).toContain('onclick={() => void loadAssignments(activeTag.id)}');
	});

	it('keeps title organization available when notebook options fail', () => {
		const organization = read('src/routes/library/organize/+page.svelte');

		expect(organization).toContain('let notebookOptionsReady = $state(false);');
		expect(organization).toContain('async function loadNotebookOptions');
		expect(organization).toContain('Não foi possível carregar os cadernos para organização.');
		expect(organization).toContain('onclick={() => void loadNotebookOptions()}');
		expect(organization).toContain('disabled={row.saving || !notebookOptionsReady}');
		expect(organization).toContain(
			'notebookId: notebookOptionsReady ? row.notebookId || null : row.document.notebookId'
		);
		expect(organization).not.toMatch(
			/Promise\.all\(\[[\s\S]*listAllDocuments\(\)[\s\S]*listNotebooks\(\)/
		);
	});

	it('prevents edits from changing context while a save is in flight', () => {
		const organization = read('src/routes/library/organize/+page.svelte');
		const tags = read('src/routes/library/tags/+page.svelte');

		expect(organization.match(/disabled=\{row\.saving\}/g)).toHaveLength(1);
		expect(organization).toContain('disabled={row.saving || !notebookOptionsReady}');
		expect(tags).toContain('disabled={saving || loadingAssignments || pendingDocumentId !== null}');
	});
});
