import { describe, expect, it } from 'vitest';
import { localDateEndIso, localDateStartIso } from '../../../src/lib/services/date-filter';

describe('local date filter boundaries', () => {
	it('uses the browser local calendar day instead of forcing UTC midnight', () => {
		expect(localDateStartIso('2026-08-02')).toBe(new Date(2026, 7, 2, 0, 0, 0, 0).toISOString());
		expect(localDateEndIso('2026-08-02')).toBe(new Date(2026, 7, 2, 23, 59, 59, 999).toISOString());
	});

	it('returns null for empty or impossible dates', () => {
		expect(localDateStartIso('')).toBeNull();
		expect(localDateEndIso('2026-02-30')).toBeNull();
		expect(localDateStartIso('02/08/2026')).toBeNull();
	});
});
