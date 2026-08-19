import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../', import.meta.url);
const migration = readFileSync(
	new URL('supabase/migrations/202608141705_gemini_rpd_budget.sql', root),
	'utf8'
);
const raisedBudgetMigration = readFileSync(
	new URL('supabase/migrations/20260817120000_raise_gemini_rpd_budget.sql', root),
	'utf8'
);
const recoveryMigration = readFileSync(
	new URL('supabase/migrations/20260818022127_reopen_ocr_jobs_after_rpd_raise.sql', root),
	'utf8'
);
const worker = readFileSync(new URL('supabase/functions/ocr-queue-worker/index.ts', root), 'utf8');
const foreground = readFileSync(new URL('supabase/functions/process-ocr/index.ts', root), 'utf8');

describe('Gemini daily request budget contract', () => {
	it('keeps the historical 15-RPD migration auditable with Pacific-time reset', () => {
		expect(migration).toContain('provider_daily_limit constant integer := 15');
		expect(migration).toContain("at time zone 'America/Los_Angeles'");
		expect(migration).toContain('daily_request_count = daily_count + 1');
		expect(migration).toContain("new.safe_error_code <> 'gemini_daily_quota'");
		expect(migration).toContain(
			'next_provider_day timestamptz := public.gemini_ocr_next_rpd_reset'
		);
	});

	it('raises the active guard to 190 RPD and reopens jobs deferred by the old guard', () => {
		expect(raisedBudgetMigration).toContain('provider_daily_limit constant integer := 190');
		expect(raisedBudgetMigration).toContain('daily_request_count = daily_count + 1');
		expect(recoveryMigration).toContain("last_error_code = 'ocr_provider_rate_queue_full'");
		expect(recoveryMigration).toContain("next_retry_at = timezone('utc', now())");
		expect(recoveryMigration).toContain("status = 'retryable'::public.ocr_status");
		expect(recoveryMigration).toContain("status = 'retryable'::public.processing_status");
	});

	it('routes reservation failures through the same fallback decision in both OCR paths', () => {
		for (const source of [worker, foreground]) {
			const attemptStart = source.indexOf('const attemptProvider = async');
			const fallbackDecision = source.indexOf(
				'shouldFallbackGeminiOcr(attempt.error)',
				attemptStart
			);

			expect(attemptStart).toBeGreaterThanOrEqual(0);
			expect(fallbackDecision).toBeGreaterThan(attemptStart);

			const attemptBlock = source.slice(attemptStart, fallbackDecision);
			expect(attemptBlock).toContain('try {');
			expect(attemptBlock).toContain('await reserveProviderSlot(');
			expect(attemptBlock).toContain('catch (error) {');
			expect(attemptBlock).toContain(
				'return Object.freeze({ ok: false as const, error, latencyMs: 0 });'
			);
		}
	});
});
