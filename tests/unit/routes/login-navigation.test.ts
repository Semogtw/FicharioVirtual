import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/login/+page.svelte', 'utf8');

describe('login completion', () => {
	it('distinguishes successful authentication from a navigation failure', () => {
		expect(source).toContain('let navigationError = $state<string | null>(null);');
		expect(source).toMatch(
			/await authenticate\(email, password\);[\s\S]*authenticated = true;[\s\S]*try \{[\s\S]*await goto\('\/'\);[\s\S]*catch \{[\s\S]*navigationError = 'Acesso confirmado, mas não foi possível abrir o fichário\.';/
		);
		expect(source).toMatch(
			/\{#if authenticated\}[\s\S]*\{#if navigationError\}<p class="error">\{navigationError\}<\/p>\{\/if\}[\s\S]*\{:else\}/
		);
		expect(source).not.toContain('sessionState.error ?? navigationError');
	});

	it('keeps a safe authentication error visible when authorization signs the session out', () => {
		expect(source).toContain('let authenticationError = $state<string | null>(null);');
		expect(source).toContain('error instanceof AuthServiceError');
		expect(source).toContain("sessionState.error ?? 'Não foi possível confirmar o acesso agora. Tente novamente.'");
		expect(source).toContain('{authenticationError ?? sessionState.error}');
	});
});
