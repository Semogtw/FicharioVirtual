import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gatePath = 'tools/checks/check-source-security.mjs';

describe('source security secret scanners', () => {
	it('does not reuse global RegExp instances across source files', () => {
		const gate = readFileSync(gatePath, 'utf8');

		expect(gate).not.toContain('/GEMINI_API_KEY\\s*=/g');
		expect(gate).not.toContain('/SUPABASE_SERVICE_ROLE/g');
		expect(gate).not.toContain('/service_role\\s*[:=]/gi');
		expect(gate).not.toContain('/AIza[0-9A-Za-z_-]{20,}/g');
	});
});
