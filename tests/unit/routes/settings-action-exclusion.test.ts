import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/settings/+page.svelte', 'utf8');

describe('settings action exclusion', () => {
	it('does not start an export while logout is in progress', () => {
		expect(source).toContain('if (exporting || signingOut) return;');
		expect(source).toContain('disabled={exporting || signingOut}');
	});

	it('does not start logout while an export is in progress', () => {
		expect(source).toContain('if (signingOut || exporting) return;');
		expect(source).toContain('disabled={signingOut || exporting}');
	});
});
