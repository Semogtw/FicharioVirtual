import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/migrate/+page.svelte';

describe('legacy Drive migration page', () => {
	it('loads pending legacy originals and migrates them independently', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('listLegacyDriveDocuments');
		expect(source).toContain('migrateLegacyDriveDocument');
		expect(source).toContain('async function migrateOne');
		expect(source).toContain('async function migrateAll');
		expect(source).toContain("label={migratingId === document.id ? 'Migrando…' : 'Migrar original'}");
		expect(source).toContain('Fallback preservado');
	});

	it('continues after one item fails and never deletes the Supabase fallback', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('failures += 1');
		expect(source).toContain('successes += 1');
		expect(source).toContain('await load()');
		expect(source).not.toContain("storage.from('documents').remove");
		expect(source).not.toContain('deleteLegacy');
	});
});
