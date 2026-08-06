import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deployment = readFileSync('docs/DEPLOYMENT.md', 'utf8');

const deployedFunctions = [
	'process-ocr',
	'delete-document',
	'drive-oauth-start',
	'drive-oauth-callback',
	'drive-access-token',
	'drive-resolve-folder',
	'drive-run-jobs',
	'drive-sync'
] as const;

const requiredOcrMigrations = [
	'202608060014_provider_only_ocr_batches.sql',
	'202608060015_ocr_batch_usage_and_hardening.sql',
	'202608060016_harden_ocr_batch_transitions.sql',
	'202608060017_harden_ocr_batch_manifest_jobs.sql',
	'202608060018_recover_stale_ocr_batches.sql'
] as const;

describe('Edge Function deployment runbook', () => {
	it('lists every currently versioned application Edge Function', () => {
		for (const functionName of deployedFunctions) {
			expect(deployment).toContain(`supabase functions deploy ${functionName}`);
		}
	});

	it('requires the complete provider-only OCR migration sequence', () => {
		for (const migration of requiredOcrMigrations) {
			expect(deployment).toContain(migration);
		}
	});

	it('documents the sole JWT gateway exception without weakening authenticated APIs', () => {
		expect(deployment).toContain('drive-oauth-callback');
		expect(deployment).toContain('verify_jwt = false');
		expect(deployment).toContain('state');
		expect(deployment).toContain('PKCE');
		expect(deployment).not.toContain('supabase functions deploy --no-verify-jwt');
	});

	it('distinguishes the local 20 MiB setting from the transitional 50 MiB migration', () => {
		expect(deployment).toContain('`supabase/config.toml` mantém `file_size_limit = "20MiB"`');
		expect(deployment).toContain('`202608060014_provider_only_ocr_batches.sql`');
		expect(deployment).toContain('50 MiB');
		expect(deployment).toContain('transitório');
	});
});
