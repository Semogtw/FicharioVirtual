import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	'supabase/migrations/202608071748_drive_pdf_reference_descriptor_attempts.sql',
	'utf8'
);

describe('Drive PDF reference page descriptor attempt migration', () => {
	it('adds an ownership lease to staged Drive PDF references', () => {
		expect(source).toContain('descriptor_attempt_id uuid');
		expect(source).toContain('descriptor_attempt_expires_at timestamptz');
		expect(source).toContain('descriptor_expected_page_count integer');
		expect(source).toContain('check (');
		expect(source).toContain('descriptor_attempt_expires_at > timezone');
	});

	it('stages page descriptors outside the document publish transaction', () => {
		expect(source).toContain('create table public.drive_pdf_reference_page_staging');
		expect(source).toContain('primary key (document_id, page_number)');
		expect(source).toContain('descriptor jsonb not null');
		expect(source).toContain('attempt_id uuid not null');
		expect(source).toContain('stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb)');
		expect(source).toContain('pg_column_size(descriptors)');
	});

	it('publishes only a complete descriptor set owned by the active attempt', () => {
		expect(source).toContain('begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)');
		expect(source).toContain('renew_drive_pdf_reference_descriptor_attempt(uuid, uuid)');
		expect(source).toContain('finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)');
		expect(source).toContain('abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid)');
		expect(source).toContain('staged_count <> expected_page_count');
		expect(source).toContain('minimum_page <> 1');
		expect(source).toContain('maximum_page <> expected_page_count');
		expect(source).toContain('from public.finalize_drive_pdf_reference_import');
	});

	it('removes authenticated bypasses around the leased publication protocol', () => {
		expect(source).toContain(
			'revoke execute on function public.finalize_drive_pdf_reference_import(uuid, jsonb, integer) from authenticated'
		);
		expect(source).toContain(
			'revoke execute on function public.stage_drive_pdf_reference_page_batch(uuid, jsonb) from authenticated'
		);
		expect(source).toContain(
			'revoke execute on function public.finalize_staged_drive_pdf_reference_import(uuid, integer, integer) from authenticated'
		);
	});
});
