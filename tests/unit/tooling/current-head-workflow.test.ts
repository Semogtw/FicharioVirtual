import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/validate-current-head.yml';

describe('current head validation workflow', () => {
	it('cancels obsolete runs so only the newest main SHA consumes the validation queue', () => {
		const workflow = readFileSync(workflowPath, 'utf8');

		expect(workflow).toContain('group: validate-current-head-${{ github.ref }}');
		expect(workflow).toContain('cancel-in-progress: true');
		expect(workflow).not.toContain('cancel-in-progress: false');
	});

	it('still validates application and infrastructure changes pushed to main', () => {
		const workflow = readFileSync(workflowPath, 'utf8');

		expect(workflow).toContain('branches: [main]');
		expect(workflow).toContain("'.github/workflows/**'");
		expect(workflow).toContain("'src/**'");
		expect(workflow).toContain("'supabase/**'");
		expect(workflow).toContain("'tests/**'");
		expect(workflow).toContain("'tools/**'");
	});
});
