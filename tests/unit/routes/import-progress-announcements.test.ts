import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tray = readFileSync('src/lib/components/ImportQueueTray.svelte', 'utf8');
const unified = readFileSync('src/lib/components/UnifiedImportPage.svelte', 'utf8');

describe('import progress announcements', () => {
	it('announces global queue status changes to assistive technology', () => {
		expect(tray).toContain('role="status"');
		expect(tray).toContain('aria-live="polite"');
		expect(tray).toContain('aria-atomic="true"');
	});

	it('also announces file-selection feedback from the unified importer', () => {
		expect(unified).toContain('role="status"');
		expect(unified).toContain('aria-live="polite"');
	});
});
