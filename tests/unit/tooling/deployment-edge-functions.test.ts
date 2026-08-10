import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync('supabase/config.toml', 'utf8');
const staging = readFileSync('docs/SUPABASE_STAGING.md', 'utf8');
const driveSetup = readFileSync('docs/GOOGLE_DRIVE_SETUP.md', 'utf8');
const desktopWorker = readFileSync('docs/DESKTOP_OCR_WORKER.md', 'utf8');
const desktopWorkerAuth = readFileSync('supabase/functions/_shared/desktop-worker-auth.ts', 'utf8');
const ocrRollout = readFileSync('docs/OCR_MIGRATION_ROLLOUT.md', 'utf8');

const versionedFunctions = readdirSync('supabase/functions', { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && entry.name !== '_shared')
	.map((entry) => entry.name)
	.sort();

const requiredOcrMigrations = [
	'202608060014_provider_only_ocr_batches.sql',
	'202608060015_ocr_batch_usage_and_hardening.sql',
	'202608060016_harden_ocr_batch_transitions.sql',
	'202608060017_harden_ocr_batch_manifest_jobs.sql',
	'202608060018_recover_stale_ocr_batches.sql',
	'202608060019_fix_ocr_batch_job_linkage.sql'
] as const;

describe('Edge Function deployment contract', () => {
	it('keeps every versioned application Edge Function covered by config and the all-functions deploy flow', () => {
		expect(versionedFunctions).toHaveLength(10);
		for (const functionName of versionedFunctions) {
			expect(config).toContain(`[functions.${functionName}]`);
		}
		expect(staging).toContain(
			'supabase functions deploy --project-ref "$STAGING_SUPABASE_PROJECT_REF"'
		);
		expect(staging).toContain(
			'supabase functions list --project-ref "$STAGING_SUPABASE_PROJECT_REF"'
		);
	});

	it('keeps the complete provider-only OCR migration sequence in its dedicated rollout', () => {
		for (const migration of requiredOcrMigrations) {
			expect(ocrRollout).toContain(migration);
		}
		expect(ocrRollout).toContain('seis migrations OCR');
	});

	it('documents the intentional gateway JWT exceptions and their replacement authentication boundaries', () => {
		expect(config).toContain('[functions.drive-oauth-callback]\nverify_jwt = false');
		expect(config).toContain('[functions.desktop-ocr-pair]\nverify_jwt = false');
		expect(config).toContain('[functions.desktop-ocr-worker]\nverify_jwt = false');
		expect(config).toContain('[functions.process-ocr]\nverify_jwt = true');
		expect(config).toContain('[functions.delete-document]\nverify_jwt = true');
		expect(staging).toContain('Não use `--no-verify-jwt` global');
		expect(driveSetup).toContain('drive-oauth-callback');
		expect(driveSetup).toContain('state');
		expect(driveSetup).toContain('PKCE');
		expect(desktopWorker).toContain('`desktop-ocr-pair` usa `verify_jwt=false`');
		expect(desktopWorkerAuth).toContain("const AUTHORIZATION_PREFIX = 'FicharioWorker '");
	});

	it('distinguishes the local 20 MiB setting from the transitional 50 MiB migration', () => {
		expect(config).toContain('file_size_limit = "20MiB"');
		expect(ocrRollout).toContain('`202608060014_provider_only_ocr_batches.sql`');
		expect(ocrRollout).toContain('50 MiB');
		expect(ocrRollout).toContain('transitória');
	});
});
