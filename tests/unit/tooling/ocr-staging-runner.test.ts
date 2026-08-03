import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

describe('OCR staging runner evidence', () => {
	it('writes a sanitized report when configuration fails before authentication', () => {
		const directory = mkdtempSync(join(tmpdir(), 'fichario-ocr-report-'));
		const reportPath = join(directory, 'report.json');
		const env = { ...process.env, OCR_STAGING_REPORT_PATH: reportPath };
		for (const name of [
			'STAGING_SUPABASE_URL',
			'STAGING_SUPABASE_PUBLISHABLE_KEY',
			'STAGING_AUTHORIZED_EMAIL',
			'STAGING_AUTHORIZED_PASSWORD'
		]) {
			delete env[name];
		}

		const result = spawnSync(
			process.execPath,
			[new URL('tools/checks/check-ocr-staging.mjs', repositoryRoot).pathname],
			{ cwd: repositoryRoot, env, encoding: 'utf8' }
		);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('Missing required environment variable');
		const report = JSON.parse(readFileSync(reportPath, 'utf8'));
		expect(report).toMatchObject({
			schemaVersion: 1,
			status: 'fail',
			failureStage: 'configuration',
			cleanup: { document: 'not_required', session: 'not_required' }
		});
		expect(statSync(reportPath).mode & 0o777).toBe(0o600);
		const serialized = JSON.stringify(report).toLowerCase();
		for (const forbidden of [
			'email',
			'userid',
			'documentid',
			'pageid',
			'jobid',
			'transcript',
			'errormessage',
			'https://'
		]) {
			expect(serialized).not.toContain(forbidden);
		}
	});
});
