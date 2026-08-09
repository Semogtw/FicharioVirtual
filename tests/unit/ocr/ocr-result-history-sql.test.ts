import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/202608081020_ocr_result_history.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('OCR result history migration', () => {
	it('creates append-only OCR provenance tied to one page and one job', () => {
		expect(source).toContain('create table public.ocr_results');
		expect(source).toContain('ocr_job_id uuid not null unique');
		expect(source).toContain("provider in ('gemini', 'local')");
		expect(source).toContain('raw_text text not null');
		expect(source).toContain('corrected_text text');
		expect(source).toContain('content_type text not null');
		expect(source).toContain('mean_confidence numeric');
		expect(source).toContain("jsonb_typeof(warnings) = 'array'");
		expect(source).toContain("jsonb_typeof(metadata) = 'object'");
	});

	it('constrains the accepted result pointer to the same page and owner', () => {
		expect(source).toContain('add column accepted_ocr_result_id uuid');
		expect(source).toContain('unique (id, page_id, user_id)');
		expect(source).toContain(
			'foreign key (accepted_ocr_result_id, id, user_id)'
		);
		expect(source).toContain('references public.ocr_results(id, page_id, user_id)');
	});

	it('keeps authenticated result access read-only and owner-scoped', () => {
		expect(source).toContain('alter table public.ocr_results enable row level security');
		expect(source).toContain('user_id = (select auth.uid())');
		expect(source).toContain('grant select on public.ocr_results to authenticated');
		expect(source).toContain('revoke insert, update, delete on public.ocr_results from authenticated');
	});

	it('backfills existing terminal OCR summaries before attaching the accepted pointer', () => {
		expect(source).toContain("'migration_backfill'");
		expect(source).toContain("page.extraction_source = 'ocr'");
		expect(source).toContain("job.status = 'ready'");
		expect(source).toContain('set accepted_ocr_result_id = result.id');
	});

	it('makes completion persist or reuse exactly one immutable job result', () => {
		expect(source).toContain('create or replace function public.complete_ocr_job');
		expect(source).toContain("set search_path = ''");
		expect(source).toContain('insert into public.ocr_results');
		expect(source).toContain('on conflict (ocr_job_id) do nothing');
		expect(source).toContain('accepted_ocr_result_id = persisted_result_id');
		expect(source).toContain('OCR completion conflicts with the persisted result');
	});

	it('keeps the completion RPC unavailable to anonymous callers', () => {
		expect(source).toContain(
			'revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) from public'
		);
		expect(source).toContain(
			'revoke execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) from anon'
		);
		expect(source).toContain(
			'grant execute on function public.complete_ocr_job(uuid, text, jsonb, public.page_status, timestamptz) to authenticated'
		);
	});
});
