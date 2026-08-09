# Renewable Drive PDF Descriptor Lease Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the renewable descriptor lease across large-Drive-PDF rendering, descriptor staging, publication, and failure cleanup without allowing a stale browser attempt to delete derivatives owned by a newer attempt.

**Architecture:** The durable `drive_pdf_reference_imports` row owns one renewable descriptor attempt. Page descriptors are staged in a separate attempt-scoped table in bounded JSONB batches, then a leased finalizer reconstructs the ordered descriptor array inside PostgreSQL and delegates to the existing hardened `finalize_drive_pdf_reference_import`. The browser acquires the lease before rendering OCR derivatives, renews it during long work, publishes through staged descriptors, and only removes uploaded derivatives when abandoning proves the same attempt still owned the lease.

**Tech Stack:** SvelteKit 5, TypeScript 5.9, Vitest 4, Supabase/PostgreSQL PL/pgSQL, Google Drive range import.

## Global Constraints

- Keep OAuth scope at `drive.file`.
- Never persist Google access/refresh tokens in the browser.
- Do not impose a logical PDF size/page-count ceiling through descriptor batch size.
- Keep descriptor transport bounded to at most 100 descriptors per RPC and reject oversized JSONB payloads.
- Preserve finalization recovery when the database committed but the HTTP response was lost.
- Never delete temporary derivatives unless the failing attempt can prove it still owns and successfully abandons the lease.
- Do not declare release readiness without the full same-SHA gates and real staging/device validation.

---

### Task 1: Make the descriptor-attempt migration match the RED contract

**Files:**
- Modify: `supabase/migrations/202608071748_drive_pdf_reference_descriptor_attempts.sql`
- Test: `tests/unit/pdf/drive-reference-descriptor-attempt-sql.test.ts`

**Interfaces:**
- Produces RPCs `begin_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)`, `renew_drive_pdf_reference_descriptor_attempt(uuid, uuid)`, `stage_drive_pdf_reference_descriptor_batch(uuid, uuid, jsonb)`, `finalize_drive_pdf_reference_descriptor_attempt(uuid, uuid, integer)`, and `abandon_drive_pdf_reference_descriptor_attempt(uuid, uuid)`.
- Produces attempt-scoped table `public.drive_pdf_reference_page_staging(document_id, page_number, attempt_id, descriptor, user_id, created_at)`.

- [ ] Keep the existing failing SQL source test as the RED receipt.
- [ ] Replace the old wrapper implementation with the attempt-scoped staging table and renewable lease RPCs.
- [ ] Validate descriptor batches as arrays of 1..100 objects and reject excessive payload bytes with `pg_column_size(descriptors)`.
- [ ] Make staging immutable/idempotent for the same `(document_id, page_number, attempt_id)` and reject stale-attempt writes.
- [ ] Make finalization require exactly pages `1..expected_page_count` for the active, unexpired attempt and delegate through `public.finalize_drive_pdf_reference_import`.
- [ ] Make abandonment return `true` only when it clears the caller's matching attempt; otherwise return `false` without touching another attempt's staging.
- [ ] Revoke legacy authenticated descriptor/finalizer entry points and grant only the leased RPC surface.
- [ ] Commit: `feat: implement renewable Drive PDF descriptor lease SQL`.

### Task 2: Expose a renewable browser lease abstraction

**Files:**
- Modify: `src/lib/pdf/drive-reference-descriptor-attempt.ts`
- Modify/Test: `tests/unit/pdf/drive-reference-descriptor-attempt.test.ts`

**Interfaces:**
- Produce `acquireDrivePdfReferenceDescriptorLease({ documentId, expectedPageCount, client })`.
- Returned lease exposes `attemptId`, `renew()`, `renewIfNeeded()`, `stageAndFinalize({ pages, promptVersion, batchSize?, signal?, onBatch? })`, and `abandon(): Promise<boolean>`.

- [ ] Add/adjust Vitest expectations for acquisition, renew RPC, bounded stage batches, finalization, abort, and boolean abandonment.
- [ ] Implement response-shape validation for begin/renew/stage results and publication passthrough for finalization.
- [ ] Track lease expiry in memory and let `renewIfNeeded()` renew before a conservative safety margin rather than per network call when unnecessary.
- [ ] Keep the existing convenience `stageAndFinalizeDrivePdfReferenceDescriptors` as a compatibility wrapper over the acquired lease.
- [ ] Commit: `feat: add renewable Drive PDF descriptor lease client`.

### Task 3: Activate the lease in the large-PDF orchestrator

**Files:**
- Modify: `src/lib/pdf/drive-reference-import.ts`
- Test: `tests/unit/pdf/drive-reference-descriptor-lease-integration.test.ts`
- Re-run related recovery/import unit tests.

**Interfaces:**
- `DrivePdfReferenceImportDependencies` gains `acquireDescriptorLease(...)`.
- The active publish path uses `lease.stageAndFinalize(...)` instead of direct `finalize_drive_pdf_reference_import`.

- [ ] Use the existing integration test as RED: acquire before rendering, renew around derivative work, publish through staged descriptors.
- [ ] Acquire after inspection/building the page plan but before rendering/uploading any OCR derivative.
- [ ] Renew before and after each rendered upload so long documents cannot silently expire the descriptor lease during CPU/network work.
- [ ] Preserve publication recovery on finalizer response loss before treating publication as failed.
- [ ] On pre-publication failure call `lease.abandon()`. Remove uploaded derivatives only when it returns `true`; if it returns `false` or errors, preserve them because ownership is ambiguous or has moved.
- [ ] Keep the pre-lease fallback cleanup path guarded by `referencePending` for failures before lease acquisition.
- [ ] Commit: `feat: publish large Drive PDFs through descriptor lease`.

### Task 4: Synchronize types, docs, and validation state

**Files:**
- Modify as needed: `src/lib/types/database.ts`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/checkpoints/2026-08-07-drive-pdf-distributed-recovery-and-descriptor-staging.md`
- Modify: `docs/READINESS.md` when the pending-item wording is stale.

- [ ] Update generated/manual database contracts only for the new table/RPC surface if required by typed callers.
- [ ] Remove the stale CURRENT_STATUS claim that the copy→stage crash window remains open; record that `appProperties` recovery is integrated.
- [ ] Mark descriptor staging as connected only after Tasks 1-3 are in the same head.
- [ ] Record the current validation limitation: this chat environment cannot clone/install because DNS to GitHub is unavailable; full gates still require the configured external/toolchain runner.
- [ ] Check latest commit/CI receipt and avoid claiming same-SHA green until a real gate run exists.
- [ ] Commit: `docs: record leased Drive PDF descriptor integration`.
