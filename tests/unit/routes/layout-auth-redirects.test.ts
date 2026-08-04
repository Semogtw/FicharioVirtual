import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/+layout.ts', 'utf8');

describe('layout authentication redirects', () => {
	it('does not catch successful SvelteKit redirect control flow', () => {
		expect(source).toContain('let session;');
		expect(source).toMatch(
			/try \{[\s\S]*session = await loadAuthorizedSession\(\);[\s\S]*\} catch \{[\s\S]*authState: 'unavailable'/
		);
		expect(source).toMatch(
			/\} catch \{[\s\S]*return \{ session: null, authState: 'unavailable' as const \};[\s\S]*\}[\s\S]*if \(session === null && !isLoginRoute\) \{[\s\S]*redirect\(307, '\/login\/'\);/
		);
		expect(source).toMatch(
			/if \(session !== null && isLoginRoute\) \{[\s\S]*redirect\(307, '\/'\);/
		);
	});
});
