import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('Supabase local configuration', () => {
	it('uses the current local SMTP section', () => {
		const config = read('supabase/config.toml');

		expect(config).toContain('[local_smtp]');
		expect(config).not.toContain('[inbucket]');
		expect(config).toMatch(/\[local_smtp\][\s\S]*?enabled\s*=\s*true/);
		expect(config).toMatch(/\[local_smtp\][\s\S]*?port\s*=\s*54324/);
	});
});
