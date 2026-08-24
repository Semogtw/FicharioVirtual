import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/routes/+layout.ts', 'utf8');
const computers = readFileSync('src/routes/settings/computers/+page.ts', 'utf8');
const queue = readFileSync('src/routes/settings/computers/queue/+page.ts', 'utf8');

describe('public desktop route guard', () => {
	it('loads the server-derived provider profile in the root layout', () => {
		expect(layout).toContain('loadCurrentProviderProfile');
		expect(layout).toContain('providerProfile');
	});

	it('blocks both desktop settings surfaces unless the profile is owner', () => {
		for (const source of [computers, queue]) {
			expect(source).toContain("providerProfile !== 'owner'");
			expect(source).toContain('error(403');
		}
	});
});
