import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/library/tags/+page.svelte', 'utf8');

describe('tags action exclusion', () => {
	it('does not start tag mutations while a membership update is pending', () => {
		expect(source).toContain(
			'if (!initialized || saving || pendingDocumentId || !newTagName.trim()) return;'
		);
		expect(source).toContain('if (!activeTag || saving || pendingDocumentId) return;');
		expect(source).toContain(
			'disabled={!initialized || saving || pendingDocumentId !== null || !newTagName.trim()}'
		);
		expect(source).toContain('disabled={saving || pendingDocumentId !== null}');
	});

	it('does not update membership while another tag mutation is running', () => {
		expect(source).toContain(
			'if (!activeTag || saving || !assignmentsReady || pendingDocumentId) return;'
		);
		expect(source).toContain(
			'disabled={saving || !assignmentsReady || pendingDocumentId !== null}'
		);
	});
});
