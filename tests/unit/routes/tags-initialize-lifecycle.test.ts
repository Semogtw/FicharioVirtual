import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/library/tags/+page.svelte', 'utf8');

describe('tags initialization lifecycle', () => {
	it('only publishes the latest tags and documents initialization', () => {
		expect(source).toContain('const initializeRequests = new RequestVersion();');
		expect(source).toContain('async function initialize(version = initializeRequests.next())');
		expect(source).toContain('if (!initializeRequests.isCurrent(version)) return;');
		expect(source).toMatch(
			/const \[loadedTags, loadedDocuments\] = await Promise\.all\([\s\S]*if \(!initializeRequests\.isCurrent\(version\)\) return;[\s\S]*tags = loadedTags;/
		);
		expect(source).toContain('if (initializeRequests.isCurrent(version)) {');
	});

	it('invalidates initialization when the route is destroyed', () => {
		expect(source).toMatch(
			/onDestroy\(\(\) => \{[\s\S]*initializeRequests\.next\(\);[\s\S]*assignmentRequests\.next\(\);/
		);
	});
});
