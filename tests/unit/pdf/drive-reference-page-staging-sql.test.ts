import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
	'supabase/migrations/202608071746_drive_pdf_reference_page_descriptor_staging.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('Drive PDF descriptor staging migration', () => {
	it('stores page descriptors under the durable reference with owner RLS', () => {
		expect(source).toContain('create table public.drive_pdf_reference_page_descriptors');
		expect(source).toContain('references public.drive_pdf_reference_imports(document_id) on delete cascade');
		expect(source).toContain('enable row level security');
		expect(source).toContain('user_id = (select auth.uid())');
		expect(source).toContain('grant select on public.drive_pdf_reference_page_descriptors to authenticated');
		expect(source).toContain('revoke insert, update, delete');
	});

	it('enforces descriptor identity, shape, and exact temporary derivative paths', () => {
		expect(source).toContain('primary key (document_id, page_number)');
		expect(source).toContain('unique (document_id, page_id)');
		expect(source).toContain('unique (document_id, job_id)');
		expect(source).toContain("char_length(native_text) <= 120000");
		expect(source).toContain("'/pages/' || page_number::text || '.webp'");
		expect(source).toContain("'/pages/' || page_number::text || '.jpg'");
	});

	it('accepts only bounded transport batches while leaving total document size to repeated calls', () => {
		expect(source).toContain('create or replace function public.stage_drive_pdf_reference_page_batch');
		expect(source).toContain('jsonb_array_length(page_descriptors) > 100');
		expect(source).not.toMatch(/page_count\s*[<>=]+\s*100\b/i);
		expect(source).not.toMatch(/total_pages\s*[<>=]+\s*100\b/i);
	});

	it('validates exact six-key payloads and uses immutable retry semantics', () => {
		expect(source).toContain('from jsonb_object_keys(descriptor)');
		expect(source).toContain("descriptor ?& array['id', 'pageNumber', 'nativeText', 'needsOcr', 'temporaryImagePath', 'jobId']");
		expect(source).toContain('on conflict (document_id, page_number) do nothing');
		expect(source).toContain('Drive PDF page descriptor retry mismatch');
	});

	it('keeps direct writes unavailable to authenticated clients and exposes only the RPC', () => {
		expect(source).toContain('security definer');
		expect(source).toContain('revoke all on function public.stage_drive_pdf_reference_page_batch');
		expect(source).toContain('grant execute on function public.stage_drive_pdf_reference_page_batch');
	});
});
