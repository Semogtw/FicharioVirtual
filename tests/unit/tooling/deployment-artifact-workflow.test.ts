import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('deployable static artifact workflow', () => {
	it('is manual, read-only, and hard-coded to the protected staging environment', () => {
		const workflow = read('.github/workflows/build-deployment-artifact.yml');

		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).toContain('environment: staging');
		expect(workflow).toContain('TARGET_ENVIRONMENT: staging');
		expect(workflow).toContain('contents: read');
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).not.toContain('target_environment:');
		expect(workflow).not.toContain('environment: production');
		expect(workflow).not.toContain('- production');
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

	it('delegates deterministic packaging to the shared staging-only packager', () => {
		const workflow = read('.github/workflows/build-deployment-artifact.yml');
		const packager = read('tools/deploy/package-static-artifact.sh');

		expect(workflow).toContain('run: bash tools/deploy/package-static-artifact.sh fichario-deploy');
		expect(packager).toContain('mkdir -p "$output_name/site" "$output_name/source" "$output_name/checks"');
		expect(packager).toContain('cp -a build/. "$output_name/site/"');
		expect(packager).toContain('cp package.json pnpm-lock.yaml "$output_name/source/"');
		expect(packager).toContain("echo 'schema_version=2'");
		expect(packager).toContain('echo "source_commit=$source_commit"');
		expect(packager).toContain("echo 'target_environment=staging'");
		expect(packager).toContain(
			'find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS'
		);
		expect(packager).toContain('sha256sum -c SHA256SUMS');
		expect(workflow).toContain('name: fichario-static-${{ github.sha }}-staging');
		expect(workflow).toContain('path: fichario-deploy/');
		expect(workflow).toContain('if-no-files-found: error');
		expect(workflow).not.toContain('supabase db push');
		expect(workflow).not.toContain('supabase functions deploy');
	});
});
