import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/hooks.client.ts', 'utf8');

describe('client theme initialization', () => {
	it('applies the persisted theme before session and queue startup', () => {
		expect(source).toContain("import { initializeTheme } from '$lib/theme/theme';");
		expect(source.indexOf('initializeTheme();')).toBeGreaterThan(-1);
		expect(source.indexOf('initializeTheme();')).toBeLessThan(
			source.indexOf('initializeSession()')
		);
	});
});
