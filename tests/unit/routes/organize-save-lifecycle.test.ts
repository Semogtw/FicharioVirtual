import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/library/organize/+page.svelte', 'utf8');

describe('document organization save lifecycle', () => {
	it('keeps concurrent row saves but suppresses their completion after teardown', () => {
		expect(source).toContain('const routeLifecycle = new RequestVersion();');
		expect(source).toContain('const lifecycleVersion = routeLifecycle.next();');
		expect(source).toMatch(
			/const updated = await updateDocumentOrganization[\s\S]*if \(!routeLifecycle\.isCurrent\(lifecycleVersion\)\) return;[\s\S]*row\.title = updated\.title;/
		);
		expect(source).toMatch(
			/catch \(caught\) \{[\s\S]*if \(routeLifecycle\.isCurrent\(lifecycleVersion\)\) \{[\s\S]*row\.error =/
		);
		expect(source).toMatch(
			/finally \{[\s\S]*if \(routeLifecycle\.isCurrent\(lifecycleVersion\)\) row\.saving = false;/
		);
		expect(source).toMatch(/onDestroy\(\(\) => \{[\s\S]*routeLifecycle\.next\(\);[\s\S]*\}\);/);
	});
});
