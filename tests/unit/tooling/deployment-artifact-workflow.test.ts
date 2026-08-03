import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('deployable static artifact workflow', () => {
	it('is manual, read-only, and selects a protected deployment environment', () => {
		const workflow = read('.github/workflows/build-deployment-artifact.yml');

		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).toContain('target_environment:');
		expect(workflow).toContain('type: choice');
		expect(workflow).toContain('- staging');
		expect(workflow).toContain('- production');
		expect(workflow).toContain('environment: ${{ inputs.target_environment }}');
		expect(workflow).toContain('contents: read');
		expect(workflow).toContain('persist-credentials: false');
	});

	it('builds with public Supabase values supplied through step environment variables', () => {
		const workflow = read('.github/workflows/build-deployment-artifact.yml');

		expect(workflow).toContain('PUBLIC_SUPABASE_URL: ${{ secrets.PUBLIC_SUPABASE_URL }}');
		expect(workflow).toContain(
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.PUBLIC_SUPABASE_PUBLISHABLE_KEY }}'
		);
		expect(workflow).toContain('pnpm install --frozen-lockfile');
		expect(workflow).toContain('pnpm verify');
		expect(workflow).toContain('PUBLIC_SUPABASE_URL');
		expect(workflow).toContain('PUBLIC_SUPABASE_PUBLISHABLE_KEY');
		expect(workflow.toLowerCase()).not.toContain('service_role');
		expect(workflow).not.toContain('GEMINI_API_KEY');
	});

	it('verifies the packaged artifact with the reusable post-download command before upload', () => {
		const workflow = read('.github/workflows/build-deployment-artifact.yml');
		const packageJson = read('package.json');

		expect(packageJson).toContain(
			'"test:deployment:artifact": "node tools/checks/check-deployment-artifact.mjs"'
		);
		expect(workflow).toContain('- name: Verify packaged deployment artifact');
		expect(workflow).toContain('run: pnpm test:deployment:artifact -- fichario-deploy');
		expect(workflow.indexOf('run: pnpm test:deployment:artifact -- fichario-deploy')).toBeLessThan(
			workflow.indexOf('- name: Upload deployable static artifact')
		);
	});

	it('packages only the static output with portable checksums and a commit manifest', () => {
		const workflow = read('.github/workflows/build-deployment-artifact.yml');

		expect(workflow).toContain('mkdir -p fichario-deploy/site fichario-deploy/source');
		expect(workflow).toContain('cp -a build/. fichario-deploy/site/');
		expect(workflow).toContain('cp package.json pnpm-lock.yaml fichario-deploy/source/');
		expect(workflow).toContain(
			'find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum'
		);
		expect(workflow).toContain('source_commit=${GITHUB_SHA}');
		expect(workflow).toContain('target_environment=${TARGET_ENVIRONMENT}');
		expect(workflow).toContain(
			'fichario-static-${{ github.sha }}-${{ inputs.target_environment }}'
		);
		expect(workflow).toContain('path: fichario-deploy/');
		expect(workflow).toContain('if-no-files-found: error');
		expect(workflow).not.toContain('supabase db push');
		expect(workflow).not.toContain('supabase functions deploy');
	});
});
