import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

describe('local OCR fault injection runner', () => {
	it('is exposed as a canonical package command', () => {
		const packageJson = JSON.parse(readFileSync(new URL('package.json', repositoryRoot), 'utf8')) as {
			scripts?: Record<string, string>;
		};

		expect(packageJson.scripts?.['test:ocr:faults:local']).toBe(
			'node tools/checks/check-ocr-fault-injection.mjs'
		);
	});

	it('proves provider failures over a real loopback HTTP server', () => {
		const script = fileURLToPath(
			new URL('tools/checks/check-ocr-fault-injection.mjs', repositoryRoot)
		);
		const result = spawnSync(process.execPath, [script], {
			cwd: fileURLToPath(repositoryRoot),
			encoding: 'utf8',
			timeout: 15_000
		});

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('OCR local fault injection: PASS');
		expect(result.stdout).toContain('7 scenarios');
	});
});
