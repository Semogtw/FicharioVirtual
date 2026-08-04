import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/login/+page.svelte', 'utf8');

describe('login lifecycle', () => {
	it('does not publish authenticated state or navigate after leaving the route', () => {
		expect(source).toContain("import { onDestroy } from 'svelte';");
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const authenticationRequests = new RequestVersion();');
		expect(source).toContain('const version = authenticationRequests.next();');
		expect(source).toMatch(
			/await authenticate\(email, password\);[\s\S]*if \(!authenticationRequests\.isCurrent\(version\)\) return;[\s\S]*authenticated = true;[\s\S]*await goto\('\/'\);/
		);
		expect(source).toMatch(
			/onDestroy\(\(\) => \{[\s\S]*authenticationRequests\.next\(\);[\s\S]*\}\);/
		);
	});
});
