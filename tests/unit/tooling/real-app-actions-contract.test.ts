import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/checks/check-real-app-actions.mjs', 'utf8');

describe('real deployed action cleanup contract', () => {
	it('detaches synthetic documents before deleting them', () => {
		expect(source).toContain('.update({ notebook_id: null })');
		expect(source).toContain(".in('id', ids)");
	});

	it('allows the background OCR-backed coverage photo flow enough time to finish', () => {
		expect(source).toContain('timeout: 300_000');
	});
});
