import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../src/lib/import/resume-database.ts', import.meta.url),
	'utf8'
);

describe('shared resume database contract', () => {
	it('upgrades one database containing image and PDF stores', () => {
		expect(source).toContain("const DATABASE_NAME = 'fichario-resume';");
		expect(source).toContain('const DATABASE_VERSION = 2;');
		expect(source).toContain("['image-imports', 'pdf-imports']");
		expect(source).toContain("database.createObjectStore(storeName, { keyPath: 'id' })");
	});
});
