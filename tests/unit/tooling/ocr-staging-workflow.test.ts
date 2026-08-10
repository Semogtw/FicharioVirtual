import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('OCR staging verification', () => {
	it('is reusable after deploy without a recurring confirmation gate', () => {
		const workflow = read('.github/workflows/verify-ocr-staging.yml');

		expect(workflow).toContain('workflow_call:');
		expect(workflow).toContain('workflow_dispatch:');
		expect(workflow).toContain('target_sha:');
		expect(workflow).not.toContain('confirm_external_ocr:');
		expect(workflow).not.toContain('Require explicit OCR confirmation');
		expect(workflow).toContain('environment: staging');
		expect(workflow).toContain('STAGING_SUPABASE_PUBLISHABLE_KEY');
		expect(workflow.toLowerCase()).not.toContain('service_role');
		expect(workflow).not.toContain('GEMINI_API_KEY');
	});

	it('uses the validated SHA, lockfile, pinned runtime, and dedicated OCR command', () => {
		const workflow = read('.github/workflows/verify-ocr-staging.yml');
		const packageJson = read('package.json');

		expect(workflow).toContain(
			"ref: ${{ inputs.target_sha != '' && inputs.target_sha || github.sha }}"
		);
		expect(workflow).toContain('contents: read');
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).toContain('version: 10');
		expect(workflow).toContain('node-version: 22.16.0');
		expect(workflow).toContain('pnpm install --frozen-lockfile');
		expect(workflow).toContain('pnpm test:staging:ocr');
		expect(workflow).toContain('OCR_STAGING_REPORT_PATH: /tmp/ocr-staging-report.json');
		expect(workflow).toContain('name: Upload sanitized OCR report');
		expect(workflow).toContain('if: always()');
		expect(workflow).toContain('path: /tmp/ocr-staging-report.json');
		expect(packageJson).toContain('"test:staging:ocr": "node tools/checks/check-ocr-staging.mjs"');
	});

	it('creates, invokes, verifies, and deletes only the synthetic OCR document', () => {
		const runner = read('tools/checks/check-ocr-staging.mjs');

		expect(runner).toContain("rpc('record_ocr_consent'");
		expect(runner).toContain("rpc('create_image_import'");
		expect(runner).toContain("functions.invoke('process-ocr'");
		expect(runner).toContain('invocation.response');
		expect(runner).toContain('createOcrInvocationDiagnostic');
		expect(runner).toContain('formatOcrInvocationFailure');
		expect(runner).toContain("functions.invoke('delete-document'");
		expect(runner).toContain('createOcrProbePng');
		expect(runner).toContain("createHash('sha256')");
		expect(runner.toLowerCase()).not.toContain('service_role');
		expect(runner).not.toContain('GEMINI_API_KEY');
	});
});
