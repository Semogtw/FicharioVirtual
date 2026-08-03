import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('documentation validation workflow', () => {
	it('runs only for documentation and its formatting inputs', () => {
		const workflow = read('.github/workflows/validate-documentation.yml');

		expect(workflow).toContain('README.md');
		expect(workflow).toContain('docs/**');
		expect(workflow).toContain('.github/workflows/validate-documentation.yml');
		expect(workflow).toContain('package.json');
		expect(workflow).toContain('pnpm-lock.yaml');
		expect(workflow).not.toContain('supabase/**');
		expect(workflow).not.toContain('src/**');
	});

	it('uses read-only permissions and the pinned Prettier toolchain', () => {
		const workflow = read('.github/workflows/validate-documentation.yml');

		expect(workflow).toContain('permissions:');
		expect(workflow).toContain('contents: read');
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).toContain('version: 10');
		expect(workflow).toContain('node-version: 22.16.0');
		expect(workflow).toContain('cache-dependency-path: pnpm-lock.yaml');
		expect(workflow).toContain('pnpm install --frozen-lockfile');
		expect(workflow).toContain('pnpm exec prettier --check README.md docs');
		expect(workflow).not.toContain('prettier --write');
	});
});
