import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core = readFileSync('tools/checks/check-real-app-flows.mjs', 'utf8');

describe('real deployed flow source contract', () => {
	it('tracks the current coverage page heading in both route sweeps', () => {
		const matches = core.match(/\/conteúdo já está no seu fichário\/i/g) ?? [];
		expect(matches).toHaveLength(2);
		expect(core).not.toContain("['/coverage/', /Cobertura/i]");
	});

	it('keeps persistent 5xx failures fatal while allowing a recovered OCR kick retry', () => {
		expect(core).toContain("url.pathname.endsWith('/ocr-queue-kick')");
		expect(core).toContain('if (status >= 500) {');
		expect(core).toContain('if (status >= 200 && status < 300) {');
		expect(core).toContain('report.browser.serverErrors.splice(recovered, 1);');
		expect(core).toContain('Server 5xx responses detected:');
	});
});
