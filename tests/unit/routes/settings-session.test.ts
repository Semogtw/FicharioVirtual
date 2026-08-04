import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/settings/+page.svelte', 'utf8');

describe('settings session boundary', () => {
	it('uses the hardened session store instead of calling the Supabase SDK directly', () => {
		expect(source).toContain(
			"import { endSession, sessionState } from '$lib/stores/session.svelte';"
		);
		expect(source).not.toContain("from '$lib/services/supabase'");
		expect(source).not.toContain('getSupabaseClient()');
		expect(source).toContain('await endSession();');
	});

	it('normalizes logout failures and always releases the local button state', () => {
		expect(source).toContain(
			"error = sessionState.error ?? 'Não foi possível encerrar a sessão agora.';"
		);
		expect(source).toMatch(
			/catch \{[\s\S]*sessionState\.error[\s\S]*\} finally \{[\s\S]*signingOut = false;/
		);
	});
});
