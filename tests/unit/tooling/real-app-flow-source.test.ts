import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const core = readFileSync('tools/checks/check-real-app-flows.mjs', 'utf8');

describe('real deployed flow source contract', () => {
	it('tracks the current coverage page heading in both route sweeps', () => {
		const matches = core.match(/\/conteúdo já está no seu fichário\/i/g) ?? [];
		expect(matches).toHaveLength(2);
		expect(core).not.toContain("['/coverage/', /Cobertura/i]");
	});

	it('keeps persistent 5xx failures fatal while clearing recovered endpoints generically', () => {
		expect(core).toContain('function trackServerResponse(response) {');
		expect(core).toContain('if (status >= 500) {');
		expect(core).toContain('if (status >= 200 && status < 300) {');
		expect(core).toContain('(value) => !value.endsWith(endpoint)');
		expect(core).toContain("page.on('response', trackServerResponse);");
		expect(core).toContain('Server 5xx responses detected:');
		expect(core).not.toContain("url.pathname.endsWith('/ocr-queue-kick')");
	});
});
