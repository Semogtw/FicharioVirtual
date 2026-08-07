import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('supabase/config.toml', 'utf8');

function verifyJwtFor(slug: string) {
	const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = config.match(
		new RegExp(`\\[functions\\.${escaped}\\]\\s*\\nverify_jwt\\s*=\\s*(true|false)`)
	);
	return match?.[1] ?? null;
}

describe('Supabase Edge Function JWT configuration', () => {
	it('keeps the OAuth callback as the only unauthenticated Edge Function', () => {
		const protectedFunctions = [
			'process-ocr',
			'delete-document',
			'drive-oauth-start',
			'drive-access-token',
			'drive-resolve-folder',
			'drive-run-jobs',
			'drive-sync'
		];

		for (const slug of protectedFunctions) {
			expect(verifyJwtFor(slug), `${slug} must verify JWTs`).toBe('true');
		}
		expect(verifyJwtFor('drive-oauth-callback')).toBe('false');
	});
});
