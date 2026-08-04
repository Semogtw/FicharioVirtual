# OCR Runner Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume runnable OCR work throughout an authorized browser session and provide cross-tab exclusion without requiring `navigator.locks`.

**Architecture:** Keep queue processing inside `OcrJobRunner`, extend its browser coordinator with an expiring `localStorage` lease, and add a focused lifecycle adapter for browser events and polling. `hooks.client.ts` owns the authorization boundary and starts or stops the lifecycle accordingly.

**Tech Stack:** TypeScript, SvelteKit client initialization, Web Locks API, Web Storage API, Vitest.

## Global Constraints

- Continue on `main`; do not rewrite history or force-push.
- Use TDD and push each coherent checkpoint.
- Queue concurrency remains two.
- Existing backoff remains 5, 20 and 60 seconds.
- Polling is five minutes and runs only while authorized, visible and online.
- External staging and device gates remain documented rather than represented as locally verified.

---

### Task 1: Browser fallback lease

**Files:**
- Modify: `src/lib/import/job-runner.ts`
- Test: `tests/unit/import/job-runner-coordinator.test.ts`

**Interfaces:**
- Produces: exported `BrowserOcrQueueCoordinator` implementing `OcrQueueCoordinator`.
- Consumes: existing `OcrQueueState` and `OcrQueueCoordinator` contracts.

- [ ] **Step 1: Write failing lease tests**

Cover rejection of a live foreign lease, successful acquisition/release, ownership loss during the settling window, owner-checked cleanup and storage-unavailable execution.

- [ ] **Step 2: Run the focused test**

Run: `pnpm test -- tests/unit/import/job-runner-coordinator.test.ts`
Expected: FAIL because the browser coordinator is not exported and has no storage lease fallback.

- [ ] **Step 3: Implement the lease fallback**

Add injected storage/time/scheduler dependencies, strict lease parsing, 15-second expiry, 5-second renewal, 50-millisecond settling and owner-checked release. Preserve Web Locks as the primary path.

- [ ] **Step 4: Run the focused test**

Run: `pnpm test -- tests/unit/import/job-runner-coordinator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit and push**

Commit: `feat: add OCR runner fallback lease`

### Task 2: Authorized browser lifecycle

**Files:**
- Create: `src/lib/import/job-runner-lifecycle.ts`
- Create: `tests/unit/import/job-runner-lifecycle.test.ts`
- Modify: `src/hooks.client.ts`
- Modify: `tests/unit/hooks/client-ocr-queue.test.ts`

**Interfaces:**
- Produces: `createOcrQueueLifecycle(resume, options?)` returning `{ start(): void; stop(): void }`.
- Consumes: `resumeQueue()` and `pauseQueue()` from `job-runner.ts`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover immediate resume, online resume, visible-only visibility resume, visible-and-online polling, idempotent start and listener/timer cleanup.

- [ ] **Step 2: Run focused tests**

Run: `pnpm test -- tests/unit/import/job-runner-lifecycle.test.ts tests/unit/hooks/client-ocr-queue.test.ts`
Expected: FAIL because the lifecycle module and hook integration do not exist.

- [ ] **Step 3: Implement lifecycle and hook integration**

Create a five-minute browser lifecycle adapter. Instantiate it once in `hooks.client.ts`; start it after authorization and stop it before pausing on session loss.

- [ ] **Step 4: Run focused tests**

Run: `pnpm test -- tests/unit/import/job-runner-lifecycle.test.ts tests/unit/hooks/client-ocr-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit and push**

Commit: `feat: resume OCR queue across browser lifecycle`

### Task 3: Full verification and documentation

**Files:**
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/READINESS.md`
- Modify: `Semogtw/Offline-Toolchains/triggers/fichario-toolchain.json` after a green repository receipt.

**Interfaces:**
- Consumes: final green FicharioVirtual commit SHA and workflow receipt.
- Produces: canonical status and toolchain pin for the validated source.

- [ ] **Step 1: Run or inspect the complete repository gate**

Run: `pnpm verify:full` when dependencies are available; otherwise use the repository `Validate current head` receipt and its failure artifacts.
Expected: frontend, source, browser, Edge and database all PASS.

- [ ] **Step 2: Update canonical documentation**

Record the validated SHA, workflow run, test count, lifecycle triggers, fallback lease and remaining external gates without claiming staging/device execution.

- [ ] **Step 3: Validate documentation commit**

Wait for the complete `Validate current head` receipt for the documentation SHA and correct any formatting artifact exactly.

- [ ] **Step 4: Pin and validate the offline toolchain**

Update the toolchain trigger to the final green SHA, inspect issue #28 and verify generated manifests/checksums when the workflow completes.

- [ ] **Step 5: Final commit/push checkpoint**

Ensure `main` points to the latest validated documentation commit and no local-only changes remain.
