import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/settings/usage/+page.svelte', 'utf8');

describe('usage route request ordering', () => {
	it('ignores older usage responses after a newer refresh starts', () => {
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const refreshRequests = new RequestVersion();');
		expect(source).toContain('async function refresh(version = refreshRequests.next())');
		expect(source).toContain('refreshRequests.isCurrent(version)');
		expect(source).toContain('const loadedOverview = await loadUsageOverview();');
	});

	it('invalidates an in-flight usage request when the route is destroyed', () => {
		expect(source).toContain("import { onDestroy, onMount } from 'svelte';");
		expect(source).toMatch(/onDestroy\(\(\) =>\s*refreshRequests\.next\(\)\);/);
	});
});
