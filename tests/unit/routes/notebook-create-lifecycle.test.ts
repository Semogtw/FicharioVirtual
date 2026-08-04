import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/notebooks/+page.svelte', 'utf8');

describe('notebook creation lifecycle', () => {
	it('does not publish a created notebook after leaving the route', () => {
		expect(source).toContain('const createRequests = new RequestVersion();');
		expect(source).toContain('const version = createRequests.next();');
		expect(source).toMatch(
			/const notebook = await createNotebook\(\{ name, description \}\);[\s\S]*if \(!createRequests\.isCurrent\(version\)\) return;[\s\S]*notebooks = Object\.freeze/
		);
		expect(source).toMatch(
			/catch \{[\s\S]*if \(createRequests\.isCurrent\(version\)\) \{[\s\S]*createError = 'Não foi possível criar o caderno\.';/
		);
		expect(source).toMatch(
			/finally \{[\s\S]*if \(createRequests\.isCurrent\(version\)\) creating = false;/
		);
		expect(source).toMatch(
			/onDestroy\(\(\) => \{[\s\S]*refreshRequests\.next\(\);[\s\S]*createRequests\.next\(\);[\s\S]*\}\);/
		);
	});
});
