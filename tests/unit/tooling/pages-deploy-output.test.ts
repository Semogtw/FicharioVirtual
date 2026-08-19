import { describe, expect, it } from 'vitest';
import { validatePagesDeployOutput } from '../../../tools/checks/validate-pages-deploy-output.mjs';

const commitHash = '0123456789abcdef0123456789abcdef01234567';

function output(overrides: Record<string, unknown> = {}) {
	return `${JSON.stringify({
		type: 'pages-deploy-detailed',
		version: 1,
		pages_project: 'fichario-virtual',
		deployment_id: '12345678-abcd-4abc-8abc-1234567890ab',
		url: 'https://abc123.fichario-virtual.pages.dev',
		alias: 'https://staging.fichario-virtual.pages.dev',
		environment: 'preview',
		production_branch: 'main',
		deployment_trigger: {
			metadata: {
				commit_hash: commitHash
			}
		},
		...overrides
	})}\n`;
}

const expectedStaging = Object.freeze({
	project: 'fichario-virtual',
	environment: 'preview' as const,
	productionBranch: 'main' as const,
	commitHash
});

const expectedProduction = Object.freeze({
	project: 'fichario-virtual',
	environment: 'production' as const,
	productionBranch: 'main' as const,
	commitHash
});

describe('Cloudflare Pages structured deployment output', () => {
	it('accepts one preview deployment matching the immutable artifact identity and staging alias', () => {
		expect(validatePagesDeployOutput(output(), expectedStaging)).toEqual({
			url: 'https://abc123.fichario-virtual.pages.dev',
			alias: 'https://staging.fichario-virtual.pages.dev',
			deploymentId: '12345678-abcd-4abc-8abc-1234567890ab'
		});
	});

	it('accepts a production deployment and resolves the stable root alias even when Wrangler reports no alias', () => {
		expect(
			validatePagesDeployOutput(
				output({ environment: 'production', alias: null }),
				expectedProduction
			)
		).toEqual({
			url: 'https://abc123.fichario-virtual.pages.dev',
			alias: 'https://fichario-virtual.pages.dev',
			deploymentId: '12345678-abcd-4abc-8abc-1234567890ab'
		});
	});

	it('accepts the root Pages URL as a production deployment URL', () => {
		expect(
			validatePagesDeployOutput(
				output({
					environment: 'production',
					alias: null,
					url: 'https://fichario-virtual.pages.dev'
				}),
				expectedProduction
			)
		).toMatchObject({ alias: 'https://fichario-virtual.pages.dev' });
	});

	it('rejects the wrong project, environment, branch or source SHA', () => {
		expect(() =>
			validatePagesDeployOutput(output({ pages_project: 'other-project' }), expectedStaging)
		).toThrow(/project/);
		expect(() =>
			validatePagesDeployOutput(output({ environment: 'production' }), expectedStaging)
		).toThrow(/environment/);
		expect(() =>
			validatePagesDeployOutput(output({ production_branch: 'develop' }), expectedStaging)
		).toThrow(/production branch/);
		expect(() =>
			validatePagesDeployOutput(
				output({ deployment_trigger: { metadata: { commit_hash: 'f'.repeat(40) } } }),
				expectedStaging
			)
		).toThrow(/source SHA/);
	});

	it('rejects malformed or ambiguous structured output', () => {
		expect(() => validatePagesDeployOutput('', expectedStaging)).toThrow(/empty/);
		expect(() => validatePagesDeployOutput('{not-json}\n', expectedStaging)).toThrow(
			/not valid JSON/
		);
		expect(() => validatePagesDeployOutput('{}\n', expectedStaging)).toThrow(/exactly one/);
		expect(() => validatePagesDeployOutput(`${output()}${output()}`, expectedStaging)).toThrow(
			/exactly one/
		);
	});

	it('rejects URLs outside the expected Pages project, decorated URLs or invalid aliases', () => {
		expect(() =>
			validatePagesDeployOutput(output({ url: 'https://abc123.other.pages.dev' }), expectedStaging)
		).toThrow(/outside/);
		expect(() =>
			validatePagesDeployOutput(
				output({ url: 'https://abc123.fichario-virtual.pages.dev/path' }),
				expectedStaging
			)
		).toThrow(/clean HTTPS origin/);
		expect(() =>
			validatePagesDeployOutput(output({ alias: 'https://example.com' }), expectedStaging)
		).toThrow(/deployment alias must be/);
		expect(() => validatePagesDeployOutput(output({ alias: null }), expectedStaging)).toThrow(
			/deployment alias is missing/
		);
		expect(() =>
			validatePagesDeployOutput(
				output({ environment: 'production', alias: 'https://example.com' }),
				expectedProduction
			)
		).toThrow(/production deployment alias must be/);
	});
});
