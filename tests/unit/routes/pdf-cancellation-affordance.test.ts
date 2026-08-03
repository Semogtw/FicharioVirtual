import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
	new URL('../../../src/routes/import/pdf/+page.svelte', import.meta.url),
	'utf8'
);

describe('PDF cancellation affordance', () => {
	it('keeps cancellation available while OCR pages are being read', () => {
		expect(pageSource).toMatch(
			/\['queued', 'inspecting', 'uploading', 'rendering', 'reading'\]\.includes\(item\.status\)/
		);
	});
});
