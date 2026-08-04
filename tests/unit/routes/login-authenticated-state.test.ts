import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/login/+page.svelte', 'utf8');

describe('login authenticated recovery state', () => {
	it('replaces the credential form after authentication succeeds', () => {
		expect(source).toContain('let authenticated = $state(false);');
		expect(source).toMatch(
			/await authenticate\(email, password\);[\s\S]*authenticated = true;[\s\S]*await goto\('\/'\);/
		);
		expect(source).toContain('{#if authenticated}');
		expect(source).toContain('Acesso confirmado.');
		expect(source).toContain('href="/"');
		expect(source).toContain('Abrir o fichário');
	});

	it('does not submit credentials again after authentication succeeds', () => {
		expect(source).toContain('if (submitting || authenticated) return;');
	});
});
