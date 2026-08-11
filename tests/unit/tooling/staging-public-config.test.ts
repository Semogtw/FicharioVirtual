import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const checker = 'tools/checks/check-staging-public-config.mjs';

function validEnv(): NodeJS.ProcessEnv {
	return {
		...process.env,
		TARGET_ENVIRONMENT: 'staging',
		PUBLIC_SUPABASE_URL: 'https://ci-release-contract.supabase.co',
		PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci_release_contract_1234567890',
		PUBLIC_GOOGLE_CLIENT_ID: '123456789012-ci-release.apps.googleusercontent.com',
		PUBLIC_GOOGLE_PICKER_API_KEY: 'AIzaCiReleaseContract1234567890',
		PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: '123456789012'
	};
}

function run(env: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, [checker], { env, encoding: 'utf8' });
}

describe('staging public release configuration checker', () => {
	it('accepts a complete staging-only Supabase and Google Drive configuration', () => {
		const result = run(validEnv());

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Staging public release configuration is valid');
	});

	it('fails closed when a core Google Drive value is absent', () => {
		const env = validEnv();
		delete env.PUBLIC_GOOGLE_PICKER_API_KEY;

		const result = run(env);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('PUBLIC_GOOGLE_PICKER_API_KEY is not configured in staging.');
	});

	it('rejects any target other than staging until production infrastructure exists', () => {
		const env = validEnv();
		env.TARGET_ENVIRONMENT = 'production';

		const result = run(env);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			'TARGET_ENVIRONMENT must remain staging until production infrastructure exists.'
		);
	});

	it('rejects a Supabase URL carrying credentials or non-origin components', () => {
		const env = validEnv();
		env.PUBLIC_SUPABASE_URL = 'https://user:pass@ci-release-contract.supabase.co/path?x=1';

		const result = run(env);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('PUBLIC_SUPABASE_URL must be a credential-free HTTPS origin.');
	});
});
