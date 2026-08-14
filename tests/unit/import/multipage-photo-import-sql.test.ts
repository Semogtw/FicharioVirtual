import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/20260814201000_multipage_photo_import.sql',
	'utf8'
);

describe('multipage photo import migration', () => {
	it('stores a distinct Drive source and hashes on every image page', () => {
		expect(migration).toContain('add column source_drive_file_id text');
		expect(migration).toContain('add column prepared_sha256 text');
		expect(migration).toContain('add column source_sha256 text');
		expect(migration).toContain('pages_bind_first_image_source');
	});

	it('only appends the next page to an owned image document', () => {
		expect(migration).toContain('create or replace function public.append_drive_image_page_v1');
		expect(migration).toContain("target_document.kind <> 'image'");
		expect(migration).toContain('target_page_number <> target_document.page_count + 1');
		expect(migration).toContain("raise exception 'invalid page order'");
	});

	it('creates an OCR job for every appended page and keeps the RPC authenticated-only', () => {
		expect(migration).toContain('insert into public.ocr_jobs');
		expect(migration).toContain("'ocr:' || target_page_id::text || ':v' || prompt_version::text");
		expect(migration).toContain('from public, anon');
		expect(migration).toContain('to authenticated');
	});
});
