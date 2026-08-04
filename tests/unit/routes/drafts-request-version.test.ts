import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/review/drafts/+page.svelte', 'utf8');

describe('draft route request ordering', () => {
	it('only publishes locations from the latest refresh', () => {
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const refreshRequests = new RequestVersion();');
		expect(source).toContain('async function refresh(version = refreshRequests.next())');
		expect(source).toContain('refreshRequests.isCurrent(version)');
		expect(source).toContain('const loadedRows = Object.freeze(');
		expect(source).toContain('rows = loadedRows;');
	});

	it('invalidates an in-flight location lookup when the route is destroyed', () => {
		expect(source).toContain("import { onDestroy, onMount } from 'svelte';");
		expect(source).toContain('onDestroy(() => {');
		expect(source).toContain('refreshRequests.next();');
	});
});
