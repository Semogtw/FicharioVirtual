import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDirectory = '.github/workflows';

describe('GitHub workflow permissions', () => {
	it('does not allow versioned workflows to push repository contents', () => {
		const offenders = readdirSync(workflowsDirectory)
			.filter((name) => /\.ya?ml$/.test(name))
			.filter((name) => {
				const source = readFileSync(join(workflowsDirectory, name), 'utf8');
				return /^\s*contents:\s*write\s*$/m.test(source);
			});

		expect(offenders).toEqual([]);
	});

	it('keeps checkout credentials disabled in workflows that do not need to publish code', () => {
		const offenders = readdirSync(workflowsDirectory)
			.filter((name) => /\.ya?ml$/.test(name))
			.filter((name) => {
				const source = readFileSync(join(workflowsDirectory, name), 'utf8');
				return (
					source.includes('actions/checkout@') &&
					!source.includes('persist-credentials: false')
				);
			});

		expect(offenders).toEqual([]);
	});
});
