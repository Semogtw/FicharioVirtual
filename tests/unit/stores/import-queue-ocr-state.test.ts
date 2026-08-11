import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../src/lib/stores/import-queue.svelte.ts', import.meta.url),
	'utf8'
);

describe('import queue OCR state', () => {
	it('persists review state from the launch completion result', () => {
		expect(source).toMatch(
			/if \(result\.state === 'complete'\) \{\s*item\.status = result\.needsReview \? 'needs_review' : 'complete';\s*void persistItem\(item\);\s*return;\s*\}/
		);
	});

	it('does not branch on removed single-page response states', () => {
		expect(source).not.toContain("result.state === 'already_complete'");
		expect(source).not.toContain("result.state === 'quota_exhausted'");
	});
});
