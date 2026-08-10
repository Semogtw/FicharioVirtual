import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowPath = '.github/workflows/validate-current-head.yml';

describe('current head validation workflow', () => {
	it('cancels obsolete runs so only the newest main SHA consumes the validation queue', () => {
		const workflow = readFileSync(workflowPath, 'utf8');

		expect(workflow).toContain('group: validate-current-head');
		expect(workflow).toContain('cancel-in-progress: true');
		expect(workflow).not.toContain('cancel-in-progress: false');
	});

	it('still validates application and infrastructure changes pushed to main', () => {
		const workflow = readFileSync(workflowPath, 'utf8');

		expect(workflow).toContain('branches: [main]');
		expect(workflow).toContain('- .github/workflows/**');
		expect(workflow).toContain('- src/**');
		expect(workflow).toContain('- supabase/**');
		expect(workflow).toContain('- tests/**');
		expect(workflow).toContain('- tools/**');
	});

	it('materializes every prerequisite outcome before rejecting an incomplete verification', () => {
		const workflow = readFileSync(workflowPath, 'utf8');
		const rejectStep = workflow.slice(workflow.indexOf('- name: Reject incomplete verification'));
		const finalReceiptIndex = rejectStep.indexOf('- name: Publish final receipt');
		const rejectBlock = rejectStep.slice(0, finalReceiptIndex);

		expect(rejectBlock).toContain('if: always()');
		for (const [name, step] of [
			['FRONTEND_OUTCOME', 'frontend'],
			['SOURCE_OUTCOME', 'source'],
			['CHROMIUM_OUTCOME', 'chromium'],
			['BROWSER_OUTCOME', 'browser'],
			['DENO_OUTCOME', 'deno'],
			['EDGE_OUTCOME', 'edge'],
			['SUPABASE_OUTCOME', 'supabase'],
			['DATABASE_OUTCOME', 'database']
		] as const) {
			expect(rejectBlock).toContain(`${name}: \${{ steps.${step}.outcome }}`);
		}
		expect(rejectBlock).toContain(`if [ "$outcome" != 'success' ]; then`);
		expect(rejectBlock).toContain('echo "Incomplete verification outcome: $outcome" >&2');
		expect(rejectBlock).toContain('exit 1');
		expect(rejectBlock).toContain("echo 'All required verification gates succeeded.'");
		expect(rejectBlock).not.toContain('exit "$failed"');
		expect(rejectBlock).not.toContain("steps.frontend.outcome != 'success'");
	});
});
