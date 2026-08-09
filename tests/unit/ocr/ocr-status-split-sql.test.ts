import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/202608081019_split_page_and_ocr_status.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('OCR status split migration', () => {
	it('rebuilds the page roll-up trigger around the page status type change', () => {
		expect(source).toContain(
			'drop trigger if exists pages_roll_up_document_status on public.pages;'
		);
		expect(source).toContain('create trigger pages_roll_up_document_status');
		expect(source).toContain('after insert or delete or update of status on public.pages');
		expect(source).toContain('execute function public.refresh_document_status_from_pages();');
	});
});
