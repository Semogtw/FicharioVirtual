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

const expected = Object.freeze({
	project: 'fichario-virtual',
	environment: 'preview',
	productionBranch: 'main',
	commitHash
});

describe('Cloudflare Pages structured deployment output', () => {
	it('accepts one deployment matching the immutable artifact identity and staging alias', () => {
		expect(validatePagesDeployOutput(output(), expected)).toEqual({
			url: 'https://abc123.fichario-virtual.pages.dev',
			alias: 'https://staging.fichario-virtual.pages.dev',
			deploymentId: '12345678-abcd-4abc-8abc-1234567890ab'
		});
	});

	it('rejects production output while the executable pipeline is staging-only', () => {
		expect(() =>
			validatePagesDeployOutput(output({ environment: 'production', alias: null }), expected)
		).toThrow(/environment/);
	});

	it('rejects the wrong project, environment, branch or source SHA', () => {
		expect(() =>
			validatePagesDeployOutput(output({ pages_project: 'other-project' }), expected)
		).toThrow(/project/);
		expect(() =>
			validatePagesDeployOutput(output({ environment: 'production' }), expected)
		).toThrow(/environment/);
		expect(() =>
			validatePagesDeployOutput(output({ production_branch: 'develop' }), expected)
		).toThrow(/production branch/);
		expect(() =>
			validatePagesDeployOutput(
				output({ deployment_trigger: { metadata: { commit_hash: 'f'.repeat(40) } } }),
				expected
			)
		).toThrow(/source SHA/);
	});

	it('rejects malformed or ambiguous structured output', () => {
		expect(() => validatePagesDeployOutput('', expected)).toThrow(/empty/);
		expect(() => validatePagesDeployOutput('{not-json}\n', expected)).toThrow(/not valid JSON/);
		expect(() => validatePagesDeployOutput('{}\n', expected)).toThrow(/exactly one/);
		expect(() => validatePagesDeployOutput(`${output()}${output()}`, expected)).toThrow(
			/exactly one/
		);
	});

	it('rejects URLs outside the expected Pages project, decorated URLs or another alias', () => {
		expect(() =>
			validatePagesDeployOutput(output({ url: 'https://abc123.other.pages.dev' }), expected)
		).toThrow(/outside/);
		expect(() =>
			validatePagesDeployOutput(
				output({ url: 'https://abc123.fichario-virtual.pages.dev/path' }),
				expected
			)
		).toThrow(/clean HTTPS origin/);
		expect(() =>
			validatePagesDeployOutput(output({ alias: 'https://example.com' }), expected)
		).toThrow(/deployment alias must be/);
		expect(() => validatePagesDeployOutput(output({ alias: null }), expected)).toThrow(
			/deployment alias is missing/
		);
	});
});
