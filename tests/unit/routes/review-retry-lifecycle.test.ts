import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/review/+page.svelte', 'utf8');

describe('review retry lifecycle', () => {
	it('does not reload or publish retry state after the route is destroyed', () => {
		expect(source).toContain('const retryRequests = new RequestVersion();');
		expect(source).toContain('const version = retryRequests.next();');
		expect(source).toContain('if (!retryRequests.isCurrent(version)) return;');
		expect(source).toMatch(
			/await processPageOcr\(item\.pageId\);[\s\S]*if \(!retryRequests\.isCurrent\(version\)\) return;[\s\S]*await load\(true\);/
		);
		expect(source).toMatch(
			/onDestroy\(\(\) => \{[\s\S]*loadRequests\.next\(\);[\s\S]*retryRequests\.next\(\);/
		);
	});
});
