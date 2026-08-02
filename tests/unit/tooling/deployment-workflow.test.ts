import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('deployed site verification workflow', () => {
	it('accepts a required URL and passes it through the environment', () => {
		const workflow = read('.github/workflows/verify-deployment.yml');

		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).toMatch(/url:\s*\n\s+description:/);
		expect(workflow).toMatch(/url:[\s\S]*?required:\s*true/);
		expect(workflow).toContain('DEPLOYMENT_URL: ${{ inputs.url }}');
		expect(workflow).toContain('pnpm test:deployment -- "$DEPLOYMENT_URL"');
		expect(workflow).not.toContain('pnpm test:deployment -- "${{ inputs.url }}"');
	});

	it('uses the repository lockfile and pinned runtime contract', () => {
		const workflow = read('.github/workflows/verify-deployment.yml');

		expect(workflow).toContain('node-version: 22.16.0');
		expect(workflow).toContain('version: 10');
		expect(workflow).toContain('cache-dependency-path: pnpm-lock.yaml');
		expect(workflow).toContain('pnpm install --frozen-lockfile');
		expect(workflow).toContain('permissions:');
		expect(workflow).toContain('contents: read');
	});
});
