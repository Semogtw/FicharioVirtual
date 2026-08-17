import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('tools/checks/check-visual-semantic-staging.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/verify-adaptive-visual-staging.yml', 'utf8');

describe('visual staging benchmark contract', () => {
	it('keeps one canonical post-deploy visual benchmark workflow', () => {
		expect(workflow).toContain('workflows: [Verify real deployed app flows]');
		expect(workflow).toContain('check-visual-semantic-staging.mjs');
		expect(workflow).toContain('SEMANTIC_VISUAL_MODE=shadow');
		for (const obsolete of [
			'.github/workflows/run-visual-staging-now.yml',
			'.github/workflows/diagnose-visual15-shadow-now.yml',
			'.github/workflows/cleanup-visual15-residue-now.yml',
			'.github/workflows/check-visual-rrf-calibration.yml'
		])
			expect(existsSync(obsolete), obsolete).toBe(false);
	});

	it('runs the expensive corpus only after the complete deployed app audit succeeds', () => {
		expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
		expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
		expect(workflow).toContain('echo \'should_run=true\' >> "$GITHUB_OUTPUT"');
		expect(workflow).toContain("needs.gate.outputs.should_run == 'true'");
		expect(workflow).toContain("needs.prepare-shadow.result == 'success'");
		expect(workflow).toContain("needs.shadow.result != 'skipped'");
		expect(workflow).not.toContain('VISUAL_POST_DEPLOY_BENCHMARK_ENABLED');
	});

	it('makes synthetic PNG identities unique without changing their visual geometry', () => {
		expect(script).toContain('function patternPng(kind, runNonce)');
		expect(script).toContain("chunk('tEXt', benchmarkMetadata)");
		expect(script).toContain('const runNonce = randomUUID()');
	});

	it('uses the production threshold and enforces top-one and negative safety', () => {
		expect(script).toContain('SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY');
		expect(script).toContain('r.rawVisualExpectedSimilarity >= VISUAL_THRESHOLD');
		expect(script).toContain('visualTop1Quality: active.metrics.visualRecallAt1 >= 0.8');
		expect(script).toContain('visualMrrQuality: active.metrics.visualMrr >= 0.8');
		expect(script).toContain('noNegativeVisualThresholdHits');
	});
});
