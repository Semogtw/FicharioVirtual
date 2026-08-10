import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const provenance = readFileSync(
	'supabase/migrations/202608101235_ocr_image_preprocessing.sql',
	'utf8'
);
const telemetry = readFileSync(
	'supabase/migrations/202608101236_ocr_preprocessing_telemetry.sql',
	'utf8'
);
const sourceDisplay = readFileSync(
	'supabase/migrations/202608101237_ocr_image_source_display.sql',
	'utf8'
);

describe('OCR image preprocessing migrations', () => {
	it('preserves a distinct raw source and gives OCR a temporary derivative', () => {
		expect(provenance).toContain('add column if not exists source_storage_path text');
		expect(provenance).toContain('add column if not exists source_sha256 text');
		expect(sourceDisplay).toContain('create or replace function public.create_image_import_v2');
		expect(sourceDisplay).toContain(
			"'image', original_filename, source_storage_path, source_storage_path"
		);
		expect(sourceDisplay).toContain('page_number, temporary_image_path, status');
		expect(sourceDisplay).toContain("1, prepared_storage_path, 'pending'");
		expect(sourceDisplay).toContain('prepared_storage_path = source_storage_path');
	});

	it('keeps Drive originals remote and gives OCR a temporary derivative', () => {
		expect(provenance).toContain('create or replace function public.create_drive_image_import_v2');
		expect(provenance).toContain('temporary_image_path, status');
		expect(provenance).toContain('ocr_storage_path');
		expect(provenance).toContain("'available', 'synced'");
	});

	it('stores only bounded preprocessing provenance on pages', () => {
		expect(provenance).toContain("ocr_preprocessing_profile in ('ocr_clean_v1')");
		expect(provenance).toContain('ocr_preprocessing_retained_permille between 1 and 1000');
		expect(provenance).toContain('ocr_preprocessing_deskew_mdeg between -4000 and 4000');
		expect(provenance).not.toMatch(
			/\b(ocr_text|prompt_text|image_bytes|base64|signed_url|api_key)\b/
		);
		expect(sourceDisplay).not.toMatch(
			/\b(ocr_text|prompt_text|image_bytes|base64|signed_url|api_key)\b/
		);
	});

	it('enriches page telemetry without elevating the preprocessing trigger', () => {
		expect(telemetry).toContain(
			'create or replace function public.fill_ocr_preprocessing_telemetry'
		);
		expect(telemetry).toContain('security invoker');
		expect(telemetry).not.toContain('security definer');
		expect(telemetry).toContain('before insert on public.ocr_provider_page_metrics');
		expect(telemetry).toContain('p.document_id = new.document_id');
	});

	it('exposes aggregate preprocessing outcomes without inventing per-page token usage', () => {
		expect(telemetry).toContain('create or replace function public.get_ocr_preprocessing_overview');
		expect(telemetry).toContain('review_pages');
		expect(telemetry).toContain('fallback_pages');
		expect(telemetry).toContain('avg_retained_permille');
		expect(telemetry).not.toContain('estimated_prompt_tokens');
	});
});
