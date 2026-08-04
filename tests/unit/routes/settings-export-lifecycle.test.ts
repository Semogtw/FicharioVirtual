import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/settings/+page.svelte', 'utf8');

describe('settings export lifecycle', () => {
	it('does not download or publish export state after leaving settings', () => {
		expect(source).toContain("import { onDestroy } from 'svelte';");
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const exportRequests = new RequestVersion();');
		expect(source).toContain('const version = exportRequests.next();');
		expect(source).toMatch(
			/const manifest = await createPortableExport\(\);[\s\S]*if \(!exportRequests\.isCurrent\(version\)\) return;[\s\S]*downloadPortableExport\(manifest\);/
		);
		expect(source).toMatch(/onDestroy\(\(\) => \{[\s\S]*exportRequests\.next\(\);[\s\S]*\}\);/);
	});
});
