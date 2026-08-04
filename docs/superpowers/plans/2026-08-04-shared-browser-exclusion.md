# Shared Browser Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use one tested exclusion primitive for OCR work and image/PDF imports across tabs, including browsers without Web Locks.

**Architecture:** Extract Web Locks and expiring localStorage lease behavior into `browser-exclusive.ts`. Keep the OCR coordinator responsible only for queue-state publication and delegate exclusion; make both import queues call the same singleton helper with their resume-key operation names.

**Tech Stack:** TypeScript, Web Locks API, Web Storage API, Vitest.

## Global Constraints

- Continue on `main`; do not force-push.
- Preserve 15-second lease duration, 5-second heartbeat and 50-millisecond settling.
- Use `ifAvailable: true`; never wait indefinitely on another tab.
- Storage-unavailable execution remains fail-open for single-context availability.
- Malformed lease records remain fail-closed.
- Commit and push each coherent TDD checkpoint.

---

### Task 1: Extract the generic exclusion primitive

**Files:**

- Create: `src/lib/import/browser-exclusive.ts`
- Create: `tests/unit/import/browser-exclusive.test.ts`
- Modify: `src/lib/import/job-runner.ts`
- Modify: `tests/unit/import/job-runner-coordinator.test.ts`

**Interfaces:**

- Produces: `BrowserExclusiveCoordinator`, `BrowserExclusiveStorage`, `BrowserExclusiveLockManager`, and `runBrowserExclusive(name, task)`.
- Consumes: operation names such as `fichario-ocr-runner`.

- [ ] **Step 1: Write generic failing tests**

Cover Web Locks preference, active foreign lease rejection, acquisition/renewal/release, settling contention, owner-checked cleanup, malformed records and inaccessible storage.

- [ ] **Step 2: Implement the generic coordinator**

Move the lease parser and acquisition algorithm without changing durations or semantics.

- [ ] **Step 3: Delegate the OCR coordinator**

Keep channel publication and compatibility option types while removing duplicated lease logic from `job-runner.ts`.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm test -- tests/unit/import/browser-exclusive.test.ts tests/unit/import/job-runner-coordinator.test.ts`
Expected: PASS.
Commit: `refactor: share browser exclusion primitive`

### Task 2: Protect image and PDF import queues

**Files:**

- Modify: `src/lib/stores/import-queue.svelte.ts`
- Modify: `src/lib/stores/pdf-import-queue.svelte.ts`
- Create: `tests/unit/stores/import-queue-cross-tab-lock.test.ts`

**Interfaces:**

- Consumes: `runBrowserExclusive(name, task)`.
- Produces: both queues use operation name `fichario-import-${resumeKey}` and retain their existing queue behavior when acquisition fails.

- [ ] **Step 1: Write source and behavior contracts**

Require both queues to import the shared helper, remove private `LockManagerLike` declarations and avoid processing when another tab owns the operation.

- [ ] **Step 2: Replace private helpers**

Delegate each `withImportLock` to `runBrowserExclusive` without changing item state transitions.

- [ ] **Step 3: Run focused tests and commit**

Run: `pnpm test -- tests/unit/stores/import-queue-cross-tab-lock.test.ts`
Expected: PASS.
Commit: `fix: protect imports without Web Locks`

### Task 3: Verify and document

**Files:**

- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/READINESS.md`

- [ ] **Step 1: Obtain a complete green current-head receipt**

Require frontend, source, Chromium, browser, Edge and database PASS.

- [ ] **Step 2: Record the validated SHA and test counts**

Document lifecycle triggers, shared exclusion and remaining external gates.

- [ ] **Step 3: Validate the documentation SHA and pin the offline toolchain**

Use only the final green commit in the toolchain trigger.
