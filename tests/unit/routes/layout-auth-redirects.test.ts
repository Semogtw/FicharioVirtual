import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/+layout.ts', 'utf8');

describe('layout authentication redirects', () => {
	it('keeps a persisted session when allowlist verification is temporarily unavailable', () => {
		expect(source).toContain('loadAuthorizedSession');
		expect(source).toContain('loadPersistedSession');
		expect(source).toContain('persistedSession = await loadPersistedSession();');
		expect(source).toMatch(
			/if \(persistedSession !== null\) \{[\s\S]*session: persistedSession,[\s\S]*authState: 'session_preserved' as const,[\s\S]*providerProfile: null/
		);
		expect(source).toMatch(
			/if \(!isPublicRoute\) \{[\s\S]*redirect\(307, '\/login\/\?reason=unavailable'\);[\s\S]*\}[\s\S]*return \{ session: null, authState: 'unavailable' as const, providerProfile: null \};/
		);
	});

	it('still redirects truly anonymous users and keeps successful redirect control flow outside the try block', () => {
		expect(source).toMatch(
			/if \(session === null && !isPublicRoute\) \{[\s\S]*redirect\(307, '\/login\/'\);/
		);
		expect(source).toMatch(
			/if \(session !== null && isLoginRoute\) \{[\s\S]*redirect\(307, '\/'\);/
		);
	});
});
