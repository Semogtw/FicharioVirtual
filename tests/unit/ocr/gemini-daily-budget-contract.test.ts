import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const migration = readFileSync(
	new URL('supabase/migrations/202608141705_gemini_rpd_budget.sql', root),
	'utf8'
);
const worker = readFileSync(new URL('supabase/functions/ocr-queue-worker/index.ts', root), 'utf8');
const foreground = readFileSync(new URL('supabase/functions/process-ocr/index.ts', root), 'utf8');

describe('Gemini daily request budget contract', () => {
	it('keeps a 15-RPD circuit breaker per model with Pacific-time reset', () => {
		expect(migration).toContain('provider_daily_limit constant integer := 15');
		expect(migration).toContain("at time zone 'America/Los_Angeles'");
		expect(migration).toContain('daily_request_count = daily_count + 1');
		expect(migration).toContain("new.safe_error_code <> 'gemini_daily_quota'");
		expect(migration).toContain(
			'next_provider_day timestamptz := public.gemini_ocr_next_rpd_reset'
		);
	});

	it('routes reservation failures through the same fallback decision in both OCR paths', () => {
		for (const source of [worker, foreground]) {
			expect(source).toMatch(
				/const attemptProvider[\s\S]*?try \{\s*await reserveProviderSlot\([\s\S]*?catch \(error\) \{\s*return Object\.freeze\(\{ ok: false as const, error, latencyMs: 0 \}\)/
			);
			expect(source).toContain('shouldFallbackGeminiOcr(attempt.error)');
		}
	});
});
