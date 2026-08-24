import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = 'tools/checks/aggregate-verification-outcomes.sh';

function run(...outcomes: string[]) {
	return spawnSync('bash', [script, ...outcomes], {
		encoding: 'utf8'
	});
}

describe('verification outcome aggregator', () => {
	it('succeeds only when every required gate succeeds', () => {
		const result = run('frontend=success', 'database=success');

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('frontend=success');
		expect(result.stdout).toContain('database=success');
		expect(result.stdout).toContain('All required verification gates succeeded.');
	});

	it('reports every failed gate while preserving a failing aggregate', () => {
		const result = run('frontend=failure', 'browser=failure', 'database=skipped');

		expect(result.status).toBe(1);
		expect(result.stdout).toContain('frontend=failure');
		expect(result.stdout).toContain('browser=failure');
		expect(result.stdout).toContain('database=skipped');
		expect(result.stderr).toContain('frontend=failure');
		expect(result.stderr).toContain('browser=failure');
		expect(result.stderr).toContain('database=skipped');
	});

	it('rejects malformed or missing gate outcomes instead of treating them as success', () => {
		const malformed = run('frontend');
		const missing = run();

		expect(malformed.status).toBe(2);
		expect(malformed.stderr).toContain('Invalid verification outcome');
		expect(missing.status).toBe(2);
		expect(missing.stderr).toContain('At least one verification outcome is required');
	});
});
