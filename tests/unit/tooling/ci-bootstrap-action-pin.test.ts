import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gate = readFileSync('tools/checks/check-ci-bootstrap.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/validate-current-head.yml', 'utf8');
const EXPECTED_SUPABASE_SETUP_SHA = '3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf';

describe('CI bootstrap action pinning', () => {
	it('keeps the validated Supabase setup action pinned to the reviewed commit', () => {
		expect(workflow).toContain(`uses: supabase/setup-cli@${EXPECTED_SUPABASE_SETUP_SHA} # v2`);
		expect(workflow).toContain('version: 2.111.0');
		expect(gate).toContain(`const EXPECTED_SUPABASE_SETUP_SHA = '${EXPECTED_SUPABASE_SETUP_SHA}';`);
		expect(workflow).not.toMatch(/uses:\s*supabase\/setup-cli@v\d+/);
		expect(workflow).not.toContain('version: latest');
	});
});
