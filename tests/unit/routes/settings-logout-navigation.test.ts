import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/settings/+page.svelte', 'utf8');

describe('settings logout completion', () => {
	it('does not report a completed logout as a session failure when navigation fails', () => {
		expect(source).toContain('let signedOut = $state(false);');
		expect(source).toMatch(
			/await endSession\(\);[\s\S]*signedOut = true;[\s\S]*try \{[\s\S]*await goto\('\/login\/'\);/
		);
		expect(source).toContain(
			"error = 'Sessão encerrada, mas não foi possível abrir a tela de acesso.';"
		);
		expect(source).toContain('{#if signedOut}');
		expect(source).toContain('Sessão encerrada.');
		expect(source).toContain('href="/login/"');
	});

	it('does not publish logout completion or navigate after leaving settings', () => {
		expect(source).toContain('const signOutRequests = new RequestVersion();');
		expect(source).toContain('const version = signOutRequests.next();');
		expect(source).toMatch(
			/await endSession\(\);[\s\S]*if \(!signOutRequests\.isCurrent\(version\)\) return;[\s\S]*signedOut = true;[\s\S]*await goto\('\/login\/'\);/
		);
		expect(source).toMatch(
			/onDestroy\(\(\) => \{[\s\S]*signOutRequests\.next\(\);[\s\S]*\}\);/
		);
	});
});
