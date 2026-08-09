import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/202608090001_force_rls_on_late_private_tables.sql',
	'utf8'
);

const tables = [
	'drive_pdf_reference_page_descriptors',
	'drive_pdf_reference_page_staging',
	'ocr_results',
	'ocr_worker_devices'
] as const;

describe('late private table RLS hardening', () => {
	it('forces row-level security for every late-created private table', () => {
		for (const table of tables) {
			expect(migration).toContain(`alter table public.${table} force row level security;`);
		}
	});
});
