import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/library/tags/+page.svelte', 'utf8');

describe('tag mutation lifecycle', () => {
	it('invalidates tag mutations and their refreshes after leaving the route', () => {
		expect(source).toContain('const mutationRequests = new RequestVersion();');
		expect(source).toMatch(
			/async function refreshTags\([\s\S]*version = mutationRequests\.current\(\)[\s\S]*const loadedTags = await listTags\(\);[\s\S]*if \(!mutationRequests\.isCurrent\(version\)\) return;/
		);
		expect(source.match(/const version = mutationRequests\.next\(\);/g)).toHaveLength(4);
		expect(source).toMatch(
			/const tagId = await createTag\(newTagName\);[\s\S]*if \(!mutationRequests\.isCurrent\(version\)\) return;[\s\S]*await refreshTags\(tagId, version\);/
		);
		expect(source).toMatch(
			/await setTagMembership\(tagId, documentId, assigned\);[\s\S]*if \(!mutationRequests\.isCurrent\(version\) \|\| activeTagId !== tagId\) return;/
		);
		expect(source).toMatch(/onDestroy\(\(\) => \{[\s\S]*mutationRequests\.next\(\);[\s\S]*\}\);/);
	});
});
