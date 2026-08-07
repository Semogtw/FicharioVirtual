import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/import/drive/+page.svelte', 'utf8');

describe('Drive import orphan reconciliation lifecycle', () => {
	it('starts old managed-copy reconciliation on mount without blocking the import page', () => {
		expect(source).toContain('reconcileOrphanedDrivePdfReferenceCopies');
		expect(source).toContain('void reconcileOrphanedDrivePdfReferenceCopies().catch(() => undefined)');
		expect(source).toContain('void Promise.all([loadNotebooks(), loadPendingReferences()])');
		expect(source).not.toContain('await reconcileOrphanedDrivePdfReferenceCopies()');
	});

	it('keeps reconciliation failures isolated from user-facing import errors', () => {
		expect(source).not.toMatch(/error\s*=\s*.*reconcil/i);
		expect(source).not.toMatch(/referenceError\s*=\s*.*reconcil/i);
	});
});
