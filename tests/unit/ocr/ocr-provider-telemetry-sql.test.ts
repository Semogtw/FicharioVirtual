import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/202608101045_ocr_provider_telemetry.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('OCR provider telemetry migration', () => {
	it('stores request-level token accounting without provider content columns', () => {
		expect(source).toContain('create table public.ocr_provider_usage_events');
		expect(source).toContain('prompt_token_count bigint');
		expect(source).toContain('candidates_token_count bigint');
		expect(source).toContain('thoughts_token_count bigint');
		expect(source).toContain('total_token_count bigint');
		expect(source).toContain('latency_ms integer not null');
		expect(source).not.toMatch(
			/\b(prompt_text|ocr_text|response_body|image_bytes|signed_url|api_key)\b/
		);
	});

	it('keeps per-page metrics separate from exact batch token totals', () => {
		expect(source).toContain('create table public.ocr_provider_page_metrics');
		expect(source).toContain('output_characters integer not null default 0');
		expect(source).toContain("content_class text not null default 'unknown'");
		expect(source).toContain('shadow_sample boolean not null default false');
		expect(source).not.toContain('estimated_prompt_tokens');
	});

	it('makes telemetry read-only to authenticated clients and owner scoped', () => {
		expect(source).toContain('force row level security');
		expect(source).toContain('user_id = (select auth.uid())');
		expect(source).toContain(
			'grant select on table public.ocr_provider_usage_events to authenticated'
		);
		expect(source).toContain(
			'grant select on table public.ocr_provider_page_metrics to authenticated'
		);
		expect(source).not.toContain(
			'grant insert on table public.ocr_provider_usage_events to authenticated'
		);
	});

	it('validates ownership and page manifests inside the telemetry writer RPC', () => {
		expect(source).toContain('create or replace function public.record_ocr_provider_usage');
		expect(source).toContain("set search_path = ''");
		expect(source).toContain('p.document_id = target_document_id');
		expect(source).toContain('p.user_id = current_user_id');
		expect(source).toContain('jsonb_to_recordset(target_page_metrics)');
	});

	it('exposes aggregate usage by time window, document kind and content class', () => {
		expect(source).toContain('create or replace function public.get_ocr_telemetry_overview');
		expect(source).toContain("'byDocumentKind'");
		expect(source).toContain("'byContentClass'");
		expect(source).toContain("'daily'");
		expect(source).toContain('window_days not between 1 and 365');
	});
});
