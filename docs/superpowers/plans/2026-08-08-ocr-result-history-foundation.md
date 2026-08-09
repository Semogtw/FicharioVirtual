# OCR Result History Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavioral slice and superpowers:executing-plans or subagent-driven-development to implement task-by-task.

**Goal:** Introduce immutable OCR result history so Gemini results today and local-worker results later can coexist without destroying provenance, while preserving the current `pages` summary fields and review UI contract.

**Architecture:** `ocr_results` becomes the append-only source of OCR result provenance. Each row belongs to one page and one OCR job and records provider/model/text/warnings plus future-facing result metadata. `pages.accepted_ocr_result_id` points to the currently accepted result and is constrained to a result owned by that same page/user. `complete_ocr_job` remains the browser/backend completion boundary: it appends or reuses the job's immutable result transactionally, updates the existing page summary for compatibility, and points the page at that result. Existing completed OCR pages are backfilled during migration so the new pointer starts coherent.

**Tech Stack:** PostgreSQL/Supabase migrations, pgTAP, PL/pgSQL, existing SvelteKit/TypeScript consumers, source-security gates.

## Global constraints

- Preserve current `pages.native_text`, `pages.ocr_raw_text`, `pages.corrected_text`, `pages.warnings`, `pages.status`, and `pages.extraction_source` behavior so the existing review/search/export UI does not need a flag-day migration.
- OCR history is append-only for authenticated clients. No browser may directly insert, update, or delete `ocr_results`.
- One OCR job may produce at most one immutable result.
- `accepted_ocr_result_id` must never point to a result from another page or user.
- Existing `complete_ocr_job` retry idempotency must remain exact: an identical retry succeeds without a duplicate result; a conflicting retry fails closed.
- Keep the future provider vocabulary compatible with the approved desktop-worker design: `gemini | local`.
- Do not hand-edit the provisional generated DB type mirror merely to claim regeneration; regenerate it only from a clean applied schema gate.
- Every new `SECURITY DEFINER` function must use `set search_path = ''` and explicit execute revocation/grants required by repository security gates.

---

### Task 1: Specify the immutable result schema as RED

**Files:**

- Add: `tests/unit/ocr/ocr-result-history-sql.test.ts`
- Add: `supabase/tests/ocr_result_history.sql`
- Update as needed: `tools/checks/test-ocr-idempotency.sh`

- [ ] Add source-level assertions for `public.ocr_results`, page ownership, one-result-per-job identity, result/page composite ownership, RLS, append-only authenticated privileges, and the accepted-result pointer.
- [ ] Add pgTAP behavior proving an authenticated user can read only their own results but cannot directly insert/update/delete them.
- [ ] Add pgTAP behavior proving completion creates exactly one result and points the matching page at it.
- [ ] Add retry behavior proving exact completion retry does not duplicate the result and conflicting retry remains rejected.
- [ ] Keep tests RED until the migration exists.
- [ ] Commit: `test: specify immutable OCR result history`.

### Task 2: Add `ocr_results` and backfill existing completed OCR pages

**Files:**

- Add: `supabase/migrations/202608081020_ocr_result_history.sql`

**Schema:**

- `ocr_results.id uuid primary key default gen_random_uuid()`
- `ocr_results.user_id uuid not null`
- `ocr_results.page_id uuid not null`
- `ocr_results.ocr_job_id uuid not null unique`
- `ocr_results.provider text not null check (provider in ('gemini','local'))`
- `ocr_results.model text not null`
- `ocr_results.raw_text text not null`
- `ocr_results.corrected_text text null`
- `ocr_results.content_type text not null default 'unknown'`
- `ocr_results.mean_confidence numeric null check (0 <= value <= 1)`
- `ocr_results.warnings jsonb not null default '[]'::jsonb`
- `ocr_results.metadata jsonb not null default '{}'::jsonb`
- `ocr_results.created_at timestamptz not null default timezone('utc', now())`
- `pages.accepted_ocr_result_id uuid null`

- [ ] Add owner-safe FKs and a unique `(id, page_id, user_id)` identity so the page pointer can use a composite FK `(accepted_ocr_result_id, id, user_id)`.
- [ ] Constrain warnings to a JSON array, metadata to a JSON object, provider to `gemini | local`, confidence to `[0,1]`, and bounded non-empty provider/model/content-type values.
- [ ] Enable RLS and grant authenticated `SELECT` only; revoke authenticated `INSERT/UPDATE/DELETE`; keep service-role maintenance access.
- [ ] Backfill one immutable result for existing completed OCR pages/jobs using current page summary text/warnings and job provider/model, marking metadata as migration backfill.
- [ ] Set each backfilled page's accepted-result pointer only after the corresponding result exists.
- [ ] Commit: `feat: add immutable OCR result history schema`.

### Task 3: Make OCR completion append/reuse a result transactionally

**Files:**

- Continue in: `supabase/migrations/202608081020_ocr_result_history.sql` or a narrowly scoped follow-up migration if clarity requires it.
- Update tests from Task 1.

- [ ] Replace `public.complete_ocr_job(...)` with an equivalent hardened signature so current Edge Function callers remain unchanged.
- [ ] Lock the job/page exactly as today and preserve all existing terminal/idempotency validation.
- [ ] Derive provider/model from the locked `ocr_jobs` row; do not trust them as caller input.
- [ ] On first successful completion, insert one immutable `ocr_results` row for the job, then update the existing page summary and `accepted_ocr_result_id` in the same transaction.
- [ ] On an exact retry, require the existing result to match the supplied text/warnings and return without inserting another row.
- [ ] On mismatch between page/job/result/input, raise the existing stable conflict error rather than mutating history.
- [ ] Preserve `ocr_jobs.status = 'ready'` and `finished_at` semantics.
- [ ] Explicitly revoke execute from `public`/`anon` and grant only `authenticated` + `service_role`.
- [ ] Commit: `feat: persist OCR completion as immutable result`.

### Task 4: Validate compatibility and document the new boundary

**Files:**

- Update: `docs/CURRENT_STATUS.md`
- Update: `docs/READINESS.md`
- Add checkpoint: `docs/checkpoints/2026-08-08-ocr-result-history-foundation.md`
- Update this plan checkboxes.

- [ ] Run lint/check/unit/source/build/E2E/Edge through the configured toolchain.
- [ ] Run clean Supabase reset + all pgTAP gates and confirm the new result-history test passes.
- [ ] Confirm existing review service can keep reading/updating `pages.corrected_text` without requiring the new table yet.
- [ ] Record `ocr_results` as foundation only; do not claim desktop devices/claim/heartbeat/model execution exist yet.
- [ ] Leave DB type regeneration explicitly pending until generated from the validated applied schema.
- [ ] Commit: `docs: record OCR result history foundation`.

### Follow-up after this slice

The next desktop-worker slice may add route/lease fields and device claim contracts to `ocr_jobs`, but it must build on immutable results rather than allowing local execution to overwrite Gemini provenance.
