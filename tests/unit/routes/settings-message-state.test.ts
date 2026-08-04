import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/settings/+page.svelte', 'utf8');

describe('settings operation messages', () => {
	it('clears a previous export success before starting logout', () => {
		expect(source).toMatch(
			/async function signOut\(\) \{[\s\S]*signingOut = true;[\s\S]*error = null;[\s\S]*message = null;[\s\S]*await endSession\(\);/
		);
	});
});
