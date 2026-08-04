import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/documents/[id]/+page.svelte', 'utf8');

describe('document action exclusion', () => {
	it('does not resume OCR while deletion is in progress', () => {
		expect(source).toContain('if (!detail || retrying || deleting) return;');
		expect(source).toContain('disabled={retrying || deleting}');
	});

	it('does not delete while OCR resume is in progress', () => {
		expect(source).toContain('if (!detail || deleting || retrying) return;');
		expect(source).toContain('disabled={deleting || retrying}');
	});
});
