import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staging auth isolation', () => {
	it('never globally signs out the shared staging account from check scripts', () => {
		const files = readdirSync('tools/checks').filter((name) => name.endsWith('.mjs'));
		for (const name of files) {
			const source = readFileSync(`tools/checks/${name}`, 'utf8');
			expect(source, name).not.toContain('.auth.signOut()');
			if (source.includes('.auth.signOut(')) {
				expect(source, name).toContain(".auth.signOut({ scope: 'local' })");
			}
		}
	});
});
