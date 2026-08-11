import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

describe('OCR staging runner evidence', () => {
	it('writes a sanitized schema-v3 report when configuration fails before authentication', () => {
		const directory = mkdtempSync(join(tmpdir(), 'fichario-ocr-report-'));
		const reportPath = join(directory, 'report.json');
		const env: NodeJS.ProcessEnv = { ...process.env, OCR_STAGING_REPORT_PATH: reportPath };
		for (const name of [
			'STAGING_SUPABASE_URL',
			'STAGING_SUPABASE_PUBLISHABLE_KEY',
			'STAGING_AUTHORIZED_EMAIL',
			'STAGING_AUTHORIZED_PASSWORD'
		])
			delete env[name];
		const result = spawnSync(
			process.execPath,
			[new URL('tools/checks/check-ocr-staging.mjs', repositoryRoot).pathname],
			{ cwd: repositoryRoot, env, encoding: 'utf8' }
		);
		expect(result.status).not.toBe(0);
		const report = JSON.parse(readFileSync(reportPath, 'utf8'));
		expect(report).toMatchObject({
			schemaVersion: 3,
			status: 'fail',
			failureStage: 'configuration',
			cleanup: { document: 'not_required', session: 'not_required' }
		});
		expect(statSync(reportPath).mode & 0o777).toBe(0o600);
	});

	it('keeps bounded probe retries without treating retry_later as terminal success', () => {
		const source = readFileSync(
			new URL('tools/checks/check-ocr-staging.mjs', repositoryRoot),
			'utf8'
		);
		expect(source).toContain(
			'const OCR_RETRY_DELAYS_MS = Object.freeze([0, 5_000, 20_000, 60_000]);'
		);
		expect(source).toContain('isRetryLater(invocation.data, pageId)');
		expect(source).toContain('const invocation = await invokeProbeOcr(client, probe.pageId);');
		expect(source).toContain(
			'assertOcrInvocation({ data: invocation?.data, pageId: probe.pageId });'
		);
	});
});
