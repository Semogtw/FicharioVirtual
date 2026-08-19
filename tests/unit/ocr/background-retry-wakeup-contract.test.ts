import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const migration = readFileSync(
	new URL('supabase/migrations/202608192058_background_ocr_retry_wakeup.sql', repositoryRoot),
	'utf8'
);

describe('background OCR retry wakeup', () => {
	it('replaces the five-minute wakeup with a due-work-only one-minute schedule', () => {
		expect(migration).toContain("cron.unschedule('fichario-background-ocr-wakeup')");
		expect(migration).toContain("'fichario-background-ocr-wakeup',\n  '* * * * *'");
		expect(migration).toContain("job.status in ('pending'::public.ocr_status, 'retryable'::public.ocr_status)");
		expect(migration).toContain('job.next_retry_at <= timezone(\'utc\', now())');
		expect(migration).toContain('and due_work.has_due');
		expect(migration).toContain("body := jsonb_build_object('source', 'cron-due-work')");
	});
});
