import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
	'supabase/migrations/202608071747_finalize_staged_drive_pdf_reference_pages.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('staged Drive PDF descriptor finalizer migration', () => {
	it('publishes from durable descriptor rows instead of accepting a giant JSON request', () => {
		expect(source).toContain('create or replace function public.finalize_staged_drive_pdf_reference_import');
		expect(source).toContain('expected_page_count integer');
		expect(source).not.toContain('page_descriptors jsonb');
		expect(source).toContain('public.drive_pdf_reference_page_descriptors');
	});

	it('requires exactly one continuous descriptor for every expected page', () => {
		expect(source).toContain('count(*)');
		expect(source).toContain('min(page_number)');
		expect(source).toContain('max(page_number)');
		expect(source).toContain('descriptor_count <> expected_page_count');
		expect(source).toContain('minimum_page_number <> 1');
		expect(source).toContain('maximum_page_number <> expected_page_count');
	});

	it('reconstructs descriptors in page order and delegates to the hardened atomic finalizer', () => {
		expect(source).toContain('jsonb_agg(');
		expect(source).toContain('order by page_number');
		expect(source).toContain('public.finalize_drive_pdf_reference_import(');
		expect(source).toContain('to_jsonb(finalized)');
	});

	it('keeps the RPC owner-scoped and unavailable to anonymous callers', () => {
		expect(source).toContain('security definer');
		expect(source).toContain('auth.uid()');
		expect(source).toContain('revoke all on function public.finalize_staged_drive_pdf_reference_import');
		expect(source).toContain('grant execute on function public.finalize_staged_drive_pdf_reference_import');
	});
});
