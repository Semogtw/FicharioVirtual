import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const draftsRoute = readFileSync('src/routes/review/drafts/+page.svelte', 'utf8');
const draftContract = readFileSync('src/lib/review/drafts.ts', 'utf8');
const clientHook = readFileSync('src/hooks.client.ts', 'utf8');

describe('local correction draft account isolation', () => {
	it('loads and discards drafts only for the active session user', () => {
		expect(draftsRoute).toContain("import { sessionState } from '$lib/stores/session.svelte';");
		expect(draftsRoute).toContain('const userId = sessionState.user?.id;');
		expect(draftsRoute).toContain('drafts = listCorrectionDrafts(userId);');
		expect(draftsRoute).toContain('discardCorrectionDraft(userId, pageId);');
		expect(draftsRoute).not.toContain('drafts = listCorrectionDrafts();');
	});

	it('uses only the account-scoped v2 draft contract with no prelaunch purge path', () => {
		expect(draftContract).toContain("const PREFIX = 'fichario:correction-draft:v2:';");
		expect(draftContract).toContain('version: 2');
		expect(draftContract).toContain('userId: ownerUserId');
		expect(clientHook).not.toContain('purgeLegacyCorrectionDrafts');
	});
});
