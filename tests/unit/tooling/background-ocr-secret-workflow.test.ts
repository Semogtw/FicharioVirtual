import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/ensure-background-ocr-secret.yml', 'utf8');

describe('background OCR worker secret provisioning workflow', () => {
	it('runs only after a successful main Supabase staging workflow or explicit recovery', () => {
		expect(source).toContain('workflows: [Deploy Supabase staging]');
		expect(source).toContain('types: [completed]');
		expect(source).toContain("github.event.workflow_run.conclusion == 'success'");
		expect(source).toContain("github.event.workflow_run.head_branch == 'main'");
		expect(source).toContain('workflow_dispatch:');
		expect(source).toContain('environment: staging-deploy');
	});

	it('keeps the worker key ephemeral and synchronizes Vault plus Edge Functions', () => {
		expect(source).toContain('worker_key="$(openssl rand -hex 32)"');
		expect(source).toContain('echo "::add-mask::$worker_key"');
		expect(source).toContain("'ocr_background_worker_key'");
		expect(source).toContain('vault.create_secret(');
		expect(source).toContain('vault.update_secret(');
		expect(source).toContain("printf 'OCR_BACKGROUND_WORKER_KEY=%s\\n' \"$worker_key\"");
		expect(source).toContain('supabase secrets set --project-ref "$STAGING_SUPABASE_PROJECT_REF"');
		expect(source).toContain("grep -q 'OCR_BACKGROUND_WORKER_KEY'");
		expect(source).not.toContain('OCR_BACKGROUND_WORKER_KEY: ${{ secrets.');
	});

	it('proves the synchronized credential against the real worker endpoint without checking out source', () => {
		expect(source).toContain('Verify real worker wake-up');
		expect(source).toContain('--header "X-Fichario-Worker-Key: $WORKER_KEY"');
		expect(source).toContain('if [ "$status" != \'202\' ]');
		expect(source).not.toContain('actions/checkout@');
	});
});
