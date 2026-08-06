# Provider-only OCR and large PDF implementation plan

> **Execution rule:** implement on the latest `main` in small commits. Refetch every shared file immediately before updating it because Drive, Cloudflare and OCR work may advance concurrently.

**Goal:** remove the application-created daily OCR ceiling, batch visual PDF pages safely, split failed/oversized batches automatically, preserve the original PDF, and expose accurate page/batch/call telemetry without breaking the existing single-page flow.

**Architecture:** the original remains the canonical object in Google Drive (or the existing transitional storage path). PDF inspection extracts native text first. Pages requiring visual recognition are rendered to conservative temporary images, grouped by a pure adaptive planner, published with a persistent batch manifest, and sent to Gemini through a strict page-keyed batch contract. A single-page request remains a one-item batch. Partial responses persist only validated pages and requeue the smallest missing subset. Provider quota responses, not a local counter, control pauses.

**Implementation choice:** use the existing rendered page artifacts as batch inputs instead of introducing a PDF-rewriting dependency. This preserves the original, supports noncontiguous mixed PDFs, permits per-page retries and avoids changing the lockfile. Compression means conservative render parameters for temporary images, never mutation of the original PDF.

**Tech stack:** SvelteKit, TypeScript, Vitest, Supabase PostgreSQL/RPC/RLS, Supabase Edge Functions/Deno, Gemini `generateContent`, existing PDF.js/pdf-inspector pipeline.

---

## Task 1: Adaptive batch planner and result integrity

**Files:**
- Create: `src/lib/ocr/batch-planner.ts`
- Test: `tests/unit/ocr/batch-planner.test.ts`

1. Write failing tests for stable ordering, route separation, 20–40 page defaults, byte ceilings, dense-page downsizing, no empty batches and deterministic bisection.
2. Add types for page candidates, planned batches and planner limits.
3. Implement `planOcrBatches()` as a pure function using page count, total derived bytes, density/layout hints and route.
4. Implement `bisectOcrBatch()` that produces two nonempty children and refuses a one-page split.
5. Add a strict page-ID set validator for missing, duplicate and unexpected results.
6. Run `pnpm test -- tests/unit/ocr/batch-planner.test.ts` when a local checkout is available.
7. Commit: `feat: add adaptive OCR batch planner`.

## Task 2: Batch structured-output contract and Gemini client

**Files:**
- Modify: `supabase/functions/_shared/ocr-contract.ts`
- Modify: `supabase/functions/_shared/gemini-ocr-client.ts`
- Modify: `tests/unit/ocr/contract.test.ts`
- Modify: `tests/unit/ocr/gemini-client.test.ts`

1. Write tests for page-keyed batch payloads, duplicate IDs, omitted IDs, unexpected IDs, warning limits and single-page compatibility.
2. Define `OcrBatchPayload`, `OcrBatchPagePayload` and validation that requires exact one-to-one correspondence with requested pages.
3. Define `GeminiOcrBatchRequest` with page ID, original page number, MIME type and bytes per page.
4. Generate a strict JSON schema whose response is `{ pages: [...] }`, keyed by `pageId` and `pageNumber`.
5. Interleave labels and inline image parts so page identity is explicit in the prompt.
6. Set output budget adaptively with a safe model maximum and retain the single-page `requestGeminiOcr()` wrapper.
7. Reject malformed/partial provider responses as `GeminiResponseError` carrying integrity details safe for retry planning.
8. Commit: `feat: add strict Gemini OCR batch contract`.

## Task 3: Remove local quota authority and persist batch telemetry

**Files:**
- Create: `supabase/migrations/202608060014_provider_only_ocr_batches.sql`
- Modify: `supabase/tests/runnable_ocr_queue.sql`
- Modify: `supabase/tests/security_rls.sql`
- Modify: `src/lib/types/database.ts`

1. Write pgTAP assertions that claims succeed regardless of an old daily count, usage increments remain informational, unauthorized users cannot claim, and provider-quota-blocked jobs can resume after their provider retry time.
2. Create `ocr_batches` with owner, document, route, state, ordered page IDs/numbers, source/derived bytes, split depth, parent batch, attempts, model/prompt and timestamps.
3. Add nullable `batch_id` and batch ordinal to `ocr_jobs` without removing existing page ownership.
4. Replace `claim_ocr_job(uuid,text,timestamptz,integer)` with `claim_ocr_job(uuid,text,timestamptz)`; increment `usage_daily.ocr_pages` unconditionally as telemetry and never use it to deny a claim.
5. Add `record_ocr_batch_call` for calls/attempts and provider quota state without exposing service credentials.
6. Add RLS/policies and indexes for owner/document/state/next retry.
7. Preserve old status compatibility while ensuring `blocked_quota` means provider quota only.
8. Regenerate the handwritten database types in `src/lib/types/database.ts` for the new table/RPCs.
9. Commit: `feat: make OCR quota provider-controlled`.

## Task 4: Batched Edge Function execution with partial retry

**Files:**
- Modify: `supabase/functions/process-ocr/index.ts`
- Modify: `supabase/functions/_shared/ocr-failure.ts`
- Modify: `tests/unit/ocr/process-ocr-delegation.test.ts`
- Create: `tests/unit/ocr/process-ocr-batch-source.test.ts`

1. Write source-contract tests requiring `{ pageId }` and `{ pageIds, batchId? }` compatibility, no daily-limit environment read, batch Gemini delegation, byte/page ceilings and partial retry handling.
2. Parse one or many unique page IDs with a conservative maximum per invocation.
3. Validate all pages belong to the authenticated user and one document, are ordered by original page number and have prepared sources.
4. Claim each page through the provider-only RPC; return completed/busy/retry states per page instead of aborting unrelated pages.
5. Download sources sequentially, enforce per-page and aggregate derived-byte ceilings, and zero byte arrays after use.
6. Call `requestGeminiOcrBatch()` once for the claimable subset.
7. Persist every validated result independently with `complete_ocr_job`.
8. On an integrity failure, mark only the affected pages retryable with a `split_required` reason. On one-page failure, use the normal finite retry/failure planner.
9. Record one provider call and page-attempt counts in batch telemetry.
10. Cleanup temporary images only for pages safely completed or already complete.
11. Return a strict aggregate result including completed/review/pending/failed page IDs and `splitRequired`.
12. Commit: `feat: process OCR pages in validated batches`.

## Task 5: Browser service and import pipeline batching

**Files:**
- Modify: `src/lib/services/ocr.ts`
- Modify: `src/lib/pdf/import-plan.ts`
- Modify: `src/lib/pdf/upload.ts`
- Modify: `src/lib/pdf/drive-upload.ts`
- Modify: `tests/unit/services/ocr.test.ts`
- Modify: `tests/unit/pdf/import-plan.test.ts`
- Modify: `tests/unit/pdf/upload.test.ts`
- Modify: `tests/unit/pdf/drive-upload.test.ts`

1. Write tests for `processOcrBatch()`, exact aggregate parsing, duplicate page rejection, abort behavior and one-page wrapper compatibility.
2. Add batch metadata to the import plan while retaining each page/job ID.
3. Plan OCR batches after rendering, using actual Blob sizes and layout hints.
4. Invoke one batch at a time with concurrency one at the batch level; provider-side concurrency remains bounded.
5. If the server requests a split, bisect and enqueue only the failed subset; never reprocess successful pages.
6. Preserve cancellation by not starting a new batch after abort and counting untouched pages as pending.
7. Remove the fixed 20 MB architectural rejection. Keep MIME/nonempty validation and allow Drive-first resumable upload; where inspection cannot safely run, surface a deferred-inspection state rather than corrupting or recompressing the original.
8. Keep temporary render defaults conservative and expose a second lower-resolution pass only when a single page exceeds the safe derived-byte limit.
9. Commit: `feat: batch PDF OCR imports adaptively`.

## Task 6: Environment, usage metrics and settings UI

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/env/private.ts`
- Modify: `tests/unit/env/private.test.ts`
- Modify: `src/lib/services/usage.ts`
- Modify: `tests/unit/services/usage.test.ts`
- Modify: `src/routes/settings/usage/+page.svelte`
- Modify: relevant settings route tests

1. Write tests proving `OCR_DAILY_HARD_LIMIT` is neither required nor parsed.
2. Add optional safe batch controls only when operationally useful (`OCR_BATCH_MAX_PAGES`, `OCR_BATCH_MAX_BYTES`), with conservative defaults in code rather than quota semantics.
3. Extend usage parsing/UI to pages, batches, provider calls, attempts, average batch size and provider quota state.
4. Remove “remaining pages” or local-quota language.
5. Show that counters are informational and distinguish `blocked_quota` from `waiting_desktop`.
6. Commit: `feat: expose informational OCR batch usage`.

## Task 7: Resume runner and cleanup integrity

**Files:**
- Modify: `src/lib/services/ocr-resume.ts`
- Modify: `tests/unit/services/ocr-resume.test.ts`
- Modify: `src/lib/stores/pdf-import-queue.svelte.ts`
- Modify: `tests/unit/stores/pdf-import-queue.test.ts`

1. Write tests that resume compatible pending pages as batches, preserve per-page idempotency and never delete a temporary image needed by another route.
2. Group runnable pages by document/route and planner limits.
3. Process batches serially with finite retry/backoff.
4. Split only failed subsets and preserve completed progress across reloads/tabs.
5. Commit: `feat: resume OCR through adaptive batches`.

## Task 8: Complete documentation and deployment gates

**Files:**
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/PROJECT_SPEC.md`
- Modify: `docs/FREE_TIER_OPERATIONS.md`
- Modify: `docs/OCR_STAGING.md`
- Modify: `docs/READINESS.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `tools/checks/check-edge-functions.sh`
- Modify: `tools/checks/check-ocr-staging.mjs`
- Add/update fixtures or static source gates as needed.

1. Replace “implementation pending” only for behavior actually implemented.
2. Document exact migration order and removal of `OCR_DAILY_HARD_LIMIT` from Supabase secrets.
3. Add staging scenarios: multi-page success, partial omission, duplicate result, truncation, aggregate-byte split, 429 short limit, provider daily quota, cancellation and unchanged original hash.
4. Add static gates preventing reintroduction of `daily_hard_limit`/`OCR_DAILY_HARD_LIMIT` in active code.
5. Document that rendered image batches implement automatic splitting; the original PDF is never rewritten.
6. Commit: `docs: complete adaptive OCR rollout guide`.

## Task 9: Verification and release evidence

1. Refetch latest `main` and compare all implementation commits against the plan.
2. Run, when environment permits: targeted Vitest, `pnpm check`, `pnpm lint`, full unit tests, build, Edge Function checks and local pgTAP gates.
3. Because the current execution environment cannot resolve `github.com`, do not claim local PASS for commands that cannot be run. Use repository CI only as supporting evidence and record missing local/staging gates explicitly.
4. Inspect combined status/workflow jobs for the final SHA.
5. Update `docs/CURRENT_STATUS.md` with exact PASS/FAIL/BLOCKED evidence and remaining external staging requirements.
6. Commit: `docs: record adaptive OCR verification evidence`.
