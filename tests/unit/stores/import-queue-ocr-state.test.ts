import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../src/lib/stores/import-queue.svelte.ts', import.meta.url),
	'utf8'
);

describe('import queue OCR state', () => {
	it('preserves review state when another worker completed the page', () => {
		expect(source).toMatch(
			/if \(result\.state === 'complete' \|\| result\.state === 'already_complete'\) \{\s*item\.status = result\.needsReview \? 'needs_review' : 'complete';\s*return;\s*\}/
		);
	});
});
