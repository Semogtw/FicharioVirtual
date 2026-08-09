import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const draftsRoute = readFileSync('src/routes/review/drafts/+page.svelte', 'utf8');
const clientHook = readFileSync('src/hooks.client.ts', 'utf8');

describe('local correction draft account isolation', () => {
	it('loads and discards drafts only for the active session user', () => {
		expect(draftsRoute).toContain("import { sessionState } from '$lib/stores/session.svelte';");
		expect(draftsRoute).toContain('const userId = sessionState.user?.id;');
		expect(draftsRoute).toContain('drafts = listCorrectionDrafts(userId);');
		expect(draftsRoute).toContain('discardCorrectionDraft(userId, pageId);');
		expect(draftsRoute).not.toContain('drafts = listCorrectionDrafts();');
		expect(draftsRoute).not.toContain('discardCorrectionDraft(pageId);');
	});

	it('purges legacy unscoped drafts before session-backed application work starts', () => {
		expect(clientHook).toContain(
			"import { purgeLegacyCorrectionDrafts } from '$lib/review/draft-index';"
		);
		const theme = clientHook.indexOf('initializeTheme();');
		const purge = clientHook.indexOf('purgeLegacyCorrectionDrafts();');
		const initializeSession = clientHook.indexOf('void initializeSession();');
		expect(theme).toBeGreaterThan(-1);
		expect(purge).toBeGreaterThan(theme);
		expect(initializeSession).toBeGreaterThan(purge);
	});
});
