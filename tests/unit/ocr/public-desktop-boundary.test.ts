import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/20260824103000_public_desktop_boundary.sql',
	'utf8'
);

describe('public desktop OCR boundary', () => {
	it('rejects public desktop routes at the database write boundary', () => {
		expect(migration).toContain('prevent_public_desktop_ocr_route');
		expect(migration).toContain("new.route::text = 'desktop'");
		expect(migration).toContain("provider_profile = 'owner'");
		expect(migration).toContain('public.ocr_batches');
		expect(migration).toContain('public.ocr_jobs');
	});

	it('allows worker registration and authentication only for owner profiles', () => {
		expect(migration).toContain('create or replace function public.register_ocr_worker_device(');
		expect(migration).toContain(
			'create or replace function public.authenticate_ocr_worker_device('
		);
		expect(migration).toContain("app_user.provider_profile = 'owner'");
		expect(migration).toContain("'User is not authorized for desktop OCR'");
	});
});
