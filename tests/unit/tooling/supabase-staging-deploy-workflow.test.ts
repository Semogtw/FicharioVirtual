import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = '.github/workflows/deploy-supabase-staging.yml';
const source = readFileSync(path, 'utf8');
const currentHeadSource = readFileSync('.github/workflows/validate-current-head.yml', 'utf8');

describe('Supabase staging migration deploy workflow', () => {
	it('automates staging only after a successful validated main SHA and keeps manual recovery', () => {
		expect(source).toContain('workflow_run:');
		expect(source).toContain('workflows: [Validate current head]');
		expect(source).toContain('types: [completed]');
		expect(source).toContain("github.event.workflow_run.conclusion == 'success'");
		expect(source).toContain("github.event.workflow_run.head_branch == 'main'");
		expect(source).toContain('workflow_dispatch:');
		expect(source).toContain('environment: staging-deploy');
		expect(source).toMatch(/permissions:\s*\n\s*contents:\s*read\s*\n\s*deployments:\s*read/);
		expect(source).not.toMatch(/^\s*contents:\s*write\s*$/m);
		expect(source).toContain('persist-credentials: false');
	});

	it('compares the validated SHA with the last successful staging deployment', () => {
		expect(source).toContain('environment=staging-deploy&per_page=20');
		expect(source).toContain('--jq \'.[0].state // ""\'');
		expect(source).toContain('git merge-base --is-ancestor "$base_sha" "$TARGET_SHA"');
		expect(source).toContain('git diff --quiet "$base_sha" "$TARGET_SHA" --');
		expect(source).toContain('supabase');
		expect(source).toContain('.github/workflows/verify-supabase-staging.yml');
		expect(source).toContain('.github/workflows/verify-ocr-staging.yml');
		expect(source).toContain('tools/checks/check-supabase-staging.mjs');
		expect(source).toContain('tools/checks/check-ocr-staging.mjs');
		expect(source).toContain('tools/checks/check-desktop-ocr-pairing-staging.mjs');
		expect(source).toContain('deploy_required: ${{ steps.changes.outputs.required }}');
	});

	it('pins the same immutable Supabase CLI action and CLI version used by current-head validation', () => {
		const action = source.match(/uses: supabase\/setup-cli@([0-9a-f]{40}) # v2/)?.[1];
		expect(action).toBeTruthy();
		expect(currentHeadSource).toContain(`uses: supabase/setup-cli@${action} # v2`);
		expect(source).toContain('version: 2.111.0');
		expect(currentHeadSource).toContain('version: 2.111.0');
	});

	it('previews pending migrations before applying the linked history in order', () => {
		const before = source.indexOf('supabase migration list --linked');
		const dryRun = source.indexOf('run: supabase db push --linked --dry-run --include-all');
		const push = source.indexOf('run: supabase db push --linked --include-all');
		const after = source.lastIndexOf('supabase migration list --linked');

		expect(before).toBeGreaterThan(-1);
		expect(dryRun).toBeGreaterThan(before);
		expect(push).toBeGreaterThan(dryRun);
		expect(after).toBeGreaterThan(push);
		expect(source).toContain('--dry-run --include-all');
		expect(source).toContain('--linked --include-all');
	});

	it('deploys versioned Edge Functions then verifies the deployed runtime with protected staging jobs', () => {
		const push = source.indexOf('run: supabase db push --linked --include-all');
		const deployFunctions = source.indexOf(
			'supabase functions deploy --project-ref "$STAGING_SUPABASE_PROJECT_REF"'
		);
		const listFunctions = source.indexOf(
			'supabase functions list --project-ref "$STAGING_SUPABASE_PROJECT_REF"'
		);

		expect(deployFunctions).toBeGreaterThan(push);
		expect(listFunctions).toBeGreaterThan(deployFunctions);
		expect(source).not.toContain('--no-verify-jwt');
		expect(source).not.toContain('--prune');

		expect(source).toContain('verify-supabase:');
		expect(source).toContain('verify-ocr:');
		expect(source).not.toContain('uses: ./.github/workflows/verify-supabase-staging.yml');
		expect(source).not.toContain('uses: ./.github/workflows/verify-ocr-staging.yml');
		expect(source).toContain("if: needs.deploy.result == 'success'");
		expect(source).toContain(
			"if: needs.deploy.result == 'success' && needs.verify-supabase.result == 'success'"
		);
		expect(source).toContain('needs: [resolve, deploy, verify-supabase]');

		const protectedVerificationJobs = source.match(/environment: staging$/gm) ?? [];
		expect(protectedVerificationJobs).toHaveLength(2);
		expect(source).toContain('group: staging-contract-verification');
		expect(source).toContain('run: pnpm test:staging:supabase');
		expect(source).toContain('run: pnpm test:staging:desktop-ocr-pairing');
		expect(source).toContain('run: pnpm test:staging:ocr');
		expect(source).toContain('STAGING_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}');
		expect(source).toContain(
			'STAGING_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(source).toContain('STAGING_AUTHORIZED_EMAIL: ${{ secrets.STAGING_AUTHORIZED_EMAIL }}');
		expect(source).toContain(
			'STAGING_AUTHORIZED_PASSWORD: ${{ secrets.STAGING_AUTHORIZED_PASSWORD }}'
		);
	});

	it('takes administrative connection material only from protected environment settings', () => {
		expect(source).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.STAGING_SUPABASE_ACCESS_TOKEN }}');
		expect(source).toContain('SUPABASE_DB_PASSWORD: ${{ secrets.STAGING_SUPABASE_DB_PASSWORD }}');
		expect(source).toContain(
			'STAGING_SUPABASE_PROJECT_REF: ${{ vars.STAGING_SUPABASE_PROJECT_REF }}'
		);
		expect(source).not.toContain('exgggshcdzjaxmfcoasm');
	});
});
