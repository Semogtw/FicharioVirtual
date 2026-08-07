import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
	'supabase/migrations/202608071748_drive_pdf_reference_descriptor_attempts.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('Drive PDF descriptor attempt leases', () => {
	it('tracks one bounded descriptor-staging attempt on the durable reference', () => {
		expect(source).toContain('descriptor_attempt_id uuid');
		expect(source).toContain('descriptor_expected_page_count integer');
		expect(source).toContain('descriptor_attempt_expires_at timestamptz');
		expect(source).toContain('descriptor_expected_page_count > 0');
	});

	it('starts or renews a lease and only replaces an expired competing attempt', () => {
		expect(source).toContain('create or replace function public.begin_drive_pdf_reference_descriptor_attempt');
		expect(source).toContain("interval '15 minutes'");
		expect(source).toContain('descriptor_attempt_expires_at > now()');
		expect(source).toContain("errcode = '55P03'");
		expect(source).toContain('delete from public.drive_pdf_reference_page_descriptors');
	});

	it('requires every page batch to carry the active attempt id and renews the lease', () => {
		expect(source).toContain('stage_drive_pdf_reference_page_batch(\n  target_document_id uuid,\n  target_attempt_id uuid,');
		expect(source).toContain('descriptor_attempt_id = target_attempt_id');
		expect(source).toContain('public.stage_drive_pdf_reference_page_batch(target_document_id, page_descriptors)');
	});

	it('allows an owner to abandon only their matching attempt', () => {
		expect(source).toContain('create or replace function public.abandon_drive_pdf_reference_descriptor_attempt');
		expect(source).toContain('descriptor_attempt_id = null');
		expect(source).toContain('descriptor_expected_page_count = null');
		expect(source).toContain('descriptor_attempt_expires_at = null');
	});

	it('finalizes only the active complete attempt through the hardened staged finalizer', () => {
		expect(source).toContain('finalize_staged_drive_pdf_reference_import(\n  target_document_id uuid,\n  target_attempt_id uuid,');
		expect(source).toContain('descriptor_expected_page_count');
		expect(source).toContain('public.finalize_staged_drive_pdf_reference_import(');
	});

	it('revokes the unleased browser RPCs once the leased wrappers exist', () => {
		expect(source).toContain('revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) from authenticated');
		expect(source).toContain('revoke execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) from authenticated');
	});
});
