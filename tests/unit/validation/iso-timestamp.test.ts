import { describe, expect, it } from 'vitest';
import { isIsoTimestamp } from '../../../src/lib/validation/iso-timestamp';

describe('isIsoTimestamp', () => {
	it.each([
		'2026-08-03T21:00:00.000Z',
		'2026-08-03T18:00:00-03:00',
		'2026-08-03T21:00:00.123456+00:00',
		'2024-02-29T00:00:00Z'
	])('accepts an exact RFC 3339 timestamp: %s', (value) => {
		expect(isIsoTimestamp(value)).toBe(true);
	});

	it.each([
		'2026-02-30T00:00:00.000Z',
		'2026-08-03',
		'01/02/2026',
		'2026-01-01junk',
		'2026-08-03T24:00:00Z',
		'2026-08-03T21:60:00Z',
		'2026-08-03T21:00:60Z',
		'2026-08-03T21:00:00',
		'2026-08-03T21:00:00.1234567Z',
		'2026-08-03T21:00:00+24:00'
	])('rejects an ambiguous or impossible timestamp: %s', (value) => {
		expect(isIsoTimestamp(value)).toBe(false);
	});
});
