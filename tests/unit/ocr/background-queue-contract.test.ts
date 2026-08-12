import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repositoryRoot), 'utf8');

const migration = read('supabase/migrations/202608111700_background_ocr_worker.sql');
const cronMigration = read('supabase/migrations/202608111705_background_ocr_cron.sql');
const candidateGuard = read('supabase/migrations/202608111715_background_ocr_candidate_guard.sql');
const worker = read('supabase/functions/ocr-queue-worker/index.ts');
const kick = read('supabase/functions/ocr-queue-kick/index.ts');
const config = read('supabase/config.toml');
const runtime = read('src/lib/services/ocr-background-runtime.ts');
const ocrEntry = read('src/lib/services/ocr.ts');
const providerGate = read('tools/checks/check-provider-only-ocr.mjs');
const appShell = read('src/lib/components/AppShell.svelte');
const importPage = read('src/lib/components/UnifiedImportPage.svelte');

describe('background OCR queue contract', () => {
	it('keeps worker database capabilities service-role only and consent-free', () => {
		expect(migration).toContain(
			'create or replace function public.list_background_gemini_ocr_candidates'
		);
		expect(migration).toContain('create or replace function public.background_ocr_as_user');
		expect(migration).toContain(
			'create or replace function public.recover_background_stale_ocr_jobs'
		);
		expect(migration).toContain(
			'create or replace function public.reconcile_background_ocr_batches'
		);
		expect(migration).toContain(
			'revoke execute on function public.background_ocr_as_user(uuid, text, jsonb) from public, anon, authenticated;'
		);
		expect(migration).toContain(
			'grant execute on function public.background_ocr_as_user(uuid, text, jsonb) to service_role;'
		);
		expect(migration).not.toMatch(
			/grant execute on function public\.background_ocr_as_user[^;]+authenticated;/s
		);
		expect(migration).not.toContain('ocr_consent_');
		expect(candidateGuard).not.toContain('ocr_consent_');
	});

	it('runs provider work after the default worker response and self-chains bounded invocations', () => {
		expect(worker).toContain('EdgeRuntime.waitUntil(runAndChain(settings));');
		expect(worker).toContain('return response(202, { accepted: true });');
		expect(worker).toContain('OCR_BACKGROUND_MAX_PAGES');
		expect(worker).toContain('OCR_BACKGROUND_TIMEOUT_MS');
		expect(worker).toContain("Deno.env.get('OCR_BACKGROUND_WORKER_KEY')");
		expect(worker).toContain("'X-Fichario-Worker-Key': settings.workerKey");
		expect(worker).not.toContain("'X-Fichario-Worker-Key': settings.serviceRoleKey");
		expect(worker).toContain("await admin.rpc('recover_background_stale_ocr_jobs')");
		expect(worker).toContain('requestGeminiOcrBatch({');
		expect(worker).toContain("'complete_geometry'");
		expect(providerGate).toContain("supabase.rpc('complete_ocr_job_with_geometry'");
	});

	it('offers a worker-key-only synchronous execution receipt without swallowing claim failures', () => {
		expect(worker).toContain("const WORKER_MODE_HEADER = 'X-Fichario-Worker-Mode';");
		expect(worker).toContain("if (mode === 'sync')");
		expect(worker).toContain('const hasMore = await drainOnce(settings);');
		expect(worker).toContain('return response(200, { completed: true, hasMore });');
		expect(worker).toContain("code: 'ocr_background_execution_failed'");
		expect(worker).toContain("console.error(`ocr_background_worker_failed:${failure}`);");
		expect(worker).toContain("if (!claim) throw new Error('Invalid background OCR claim response');");
		expect(worker).not.toContain("}).catch(() => null);\n\t\tconst claim = value ? parseOcrClaimResult(value) : null;");
	});

	it('reuses the launch Gemini rate limiter and 429-only fallback routing', () => {
		expect(worker).toContain("admin.rpc('reserve_ocr_provider_rate_slot'");
		expect(worker).toContain('shouldFallbackGeminiOcr(attempt.error)');
		expect(worker).toContain('attemptProvider(settings.fallbackModel, settings.fallbackRpm)');
		expect(worker).toContain("routeReason = 'fallback_gemini_rate_limit'");
		expect(worker).toContain('DEFAULT_GEMINI_OCR_PRIMARY_MODEL');
		expect(worker).toContain('DEFAULT_GEMINI_OCR_FALLBACK_MODEL');
	});

	it('exposes only an authenticated browser kick while keeping the worker gateway custom-authenticated', () => {
		expect(config).toContain('[functions.ocr-queue-kick]\nverify_jwt = true');
		expect(config).toContain('[functions.ocr-queue-worker]\nverify_jwt = false');
		expect(kick).toContain('userClient.auth.getUser()');
		expect(kick).toContain(".eq('is_active', true)");
		expect(kick).toContain("Deno.env.get('OCR_BACKGROUND_WORKER_KEY')");
		expect(kick).toContain("'X-Fichario-Worker-Key': workerKey");
		expect(kick).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
	});

	it('keeps deferred wakeups cheap and quota retries time-bound', () => {
		expect(cronMigration).toContain("'*/5 * * * *'");
		expect(cronMigration).toContain("where name in ('project_url', 'ocr_background_worker_key')");
		expect(candidateGuard).toContain("job.status = 'blocked_quota'::public.ocr_status");
		expect(candidateGuard).toContain('and job.next_retry_at is not null');
		expect(candidateGuard).toContain(
			'grant execute on function public.list_background_gemini_ocr_candidates(integer) to service_role;'
		);
	});

	it('defers normal browser OCR calls but preserves injected foreground clients for tests and probes', () => {
		expect(ocrEntry).toContain("from './ocr-background-runtime';");
		expect(runtime).toContain(
			'if (client) return processPageOcrForeground(pageId, client, options);'
		);
		expect(runtime).toContain(
			'if (client) return processOcrBatchForeground(pageIds, client, options);'
		);
		expect(runtime).toContain('await kick(options.signal);');
		expect(runtime).toContain("state: 'retry_later' as const");
	});

	it('surfaces one global queue and accepts mixed PDF/image intake without a consent checkbox', () => {
		expect(appShell).toContain("import ImportQueueTray from './ImportQueueTray.svelte';");
		expect(appShell).toContain('<ImportQueueTray />');
		expect(importPage).toContain("import { addImages } from '$lib/stores/import-queue.svelte';");
		expect(importPage).toContain("import { addPdfs } from '$lib/stores/pdf-import-queue.svelte';");
		expect(importPage).toContain('accept="application/pdf,image/jpeg,image/png,image/webp"');
		expect(importPage).toContain('multiple');
		expect(importPage).toContain('Leitura em segundo plano');
		expect(importPage).not.toContain('Autorizo o envio');
	});
});
