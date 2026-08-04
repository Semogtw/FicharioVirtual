import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/login/+page.svelte', 'utf8');

describe('login completion', () => {
	it('distinguishes successful authentication from a navigation failure', () => {
		expect(source).toContain('let navigationError = $state<string | null>(null);');
		expect(source).toMatch(
			/await authenticate\(email, password\);[\s\S]*try \{[\s\S]*await goto\('\/'\);[\s\S]*catch \{[\s\S]*navigationError = 'Acesso confirmado, mas não foi possível abrir o fichário\.';/
		);
		expect(source).toContain('{#if sessionState.error ?? navigationError}');
		expect(source).toContain('{sessionState.error ?? navigationError}');
	});
});
