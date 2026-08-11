import { describe, expect, it } from 'vitest';
import { parseOcrClaimResult } from '../../../supabase/functions/_shared/ocr-contract';

describe('OCR claim result parser', () => {
	const jobId = '123e4567-e89b-42d3-a456-426614174000';

	it.each([
		{ state: 'not_authorized' },
		{ state: 'invalid_configuration' },
		{ state: 'not_found' },
		{ state: 'already_complete', jobId },
		{ state: 'busy', jobId },
		{ state: 'not_retryable', jobId },
		{ state: 'retry_later', jobId, nextRetryAt: '2026-08-03T01:00:00+00:00' },
		{ state: 'quota_exhausted', jobId, nextRetryAt: '2026-08-04T00:00:00Z' },
		{ state: 'claimed', jobId, attemptCount: 2, usageToday: 3 }
	])('accepts exact claim result $state', (claim) => {
		expect(parseOcrClaimResult(claim)).toEqual(claim);
	});

	it.each([
		null,
		[],
		{ state: 'unknown' },
		{ state: 'consent_required' },
		{ state: 'not_found', extra: true },
		{ state: 'busy' },
		{ state: 'busy', jobId: 'not-a-uuid' },
		{ state: 'retry_later', jobId, nextRetryAt: 'tomorrow' },
		{ state: 'quota_exhausted', jobId },
		{ state: 'claimed', jobId, attemptCount: '1', usageToday: 1 },
		{ state: 'claimed', jobId, attemptCount: 1, usageToday: 0 },
		{ state: 'claimed', jobId, attemptCount: 1, usageToday: 1, extra: true }
	])('rejects malformed claim result %#', (claim) => {
		expect(parseOcrClaimResult(claim)).toBeNull();
	});
});
