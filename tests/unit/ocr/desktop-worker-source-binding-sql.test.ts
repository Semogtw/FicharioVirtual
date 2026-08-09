import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/202608081030_fix_desktop_ocr_source_binding_clock.sql';
const source = readFileSync(migrationPath, 'utf8');

describe('desktop OCR source binding clock migration', () => {
	it('compares lease timestamps using a UTC timestamptz value', () => {
		expect(source).toContain("current_utc timestamptz := timezone('utc', now())");
		expect(source).toContain('job.desktop_lease_expires_at > current_utc');
		expect(source).toContain('desktop_source_bound_at, current_utc');
		expect(source).not.toContain('current_time');
	});
});
