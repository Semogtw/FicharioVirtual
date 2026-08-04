import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/hooks.client.ts', 'utf8');

describe('client session bootstrap', () => {
	it('initializes the session once and revalidates active loads after an external sign-out', () => {
		expect(source).toContain("import { invalidateAll } from '$app/navigation';");
		expect(source).toContain("import type { ClientInit } from '@sveltejs/kit';");
		expect(source).toContain('initializeSession');
		expect(source).toContain('startSessionTracking');
		expect(source).toContain('export const init: ClientInit = () => {');
		expect(source).toMatch(
			/void initializeSession\(\);[\s\S]*startSessionTracking\(\(\) => void invalidateAll\(\)\);/
		);
	});
});
