# Release Readiness Codifiable Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining release-readiness gap that can be completed in code without staging credentials, a deployed HTTPS host, or physical devices.

**Architecture:** Keep the existing queues and remote-session contracts unchanged. Add a browser-level two-page regression around the existing cross-tab coordination boundary, align the reproducible offline workspace trigger to the final green source SHA, and make readiness documentation derive its claims from the latest validated workflow rather than stale historical counts.

**Tech Stack:** SvelteKit 5, TypeScript, Vitest, Playwright Chromium, GitHub Actions, Markdown, Offline-Toolchains.

## Global Constraints

- Continue on `main`, the repository's current and explicitly approved development branch.
- Use test-first commits for behavioral changes.
- Do not add secrets, paid fallbacks, fault-injection controls, or authenticated response caching.
- Treat the GitHub workflow for the exact commit SHA as the full verification gate.
- Keep commits small and push every independently reviewable step.

---

### Task 1: Browser-level multi-tab regression

**Files:**
- Modify: the existing Playwright test suite under `tests/e2e/`
- Modify only when required: Playwright support utilities already used by the suite

**Interfaces:**
- Consumes: the existing image/PDF import queue, IndexedDB persistence, `BroadcastChannel`, and browser-exclusive coordination.
- Produces: one deterministic Chromium scenario proving that two pages sharing one browser context do not both resume or complete the same persisted import.

- [ ] Inspect the current Playwright fixtures and import-flow test seams.
- [ ] Add a failing two-page scenario using one browser context.
- [ ] Verify that the test fails for the intended missing browser-level assertion rather than setup instability.
- [ ] Add the minimum test seam or production correction needed for determinism.
- [ ] Run the focused Playwright scenario and then the complete validation workflow.
- [ ] Commit the red test separately from any production fix.

### Task 2: Offline toolchain alignment

**Files:**
- Modify in `Semogtw/Offline-Toolchains`: `triggers/fichario-toolchain.json`

**Interfaces:**
- Consumes: final green `FicharioVirtual` SHA.
- Produces: an offline workspace build receipt tied to that exact source revision.

- [ ] Confirm the latest `main` SHA and its full validation receipt.
- [ ] Update the trigger to the exact green SHA.
- [ ] Wait for the toolchain workflow receipt and record the result.
- [ ] Do not advance the trigger to an unvalidated documentation or code SHA.

### Task 3: Readiness documentation reconciliation

**Files:**
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/READINESS.md`
- Create: a checkpoint note for this continuation when code changes are made

**Interfaces:**
- Consumes: exact workflow counts and receipts for the final SHA.
- Produces: a single consistent statement of implemented, externally pending, and device-only work.

- [ ] Replace stale test/migration counts with the latest validated figures.
- [ ] Mark the prior documentation SHA as validated.
- [ ] Separate codifiable gaps from staging/host/device requirements.
- [ ] Include exact external setup steps without credentials or secret values.
- [ ] Run the documentation workflow and then the full workflow for the final documentation SHA.

### Task 4: Final audit for additional codifiable gaps

**Files:**
- Inspect: workflows, import/OCR services, deployment verification scripts, documentation, and open issues.
- Modify only files directly tied to a demonstrated gap.

**Interfaces:**
- Consumes: current source tree and validation logs.
- Produces: either additional tested fixes or an evidence-backed statement that remaining work is external.

- [ ] Search for stale TODO/FIXME markers, skipped tests, and documented NOT RUN items.
- [ ] Classify each as code, staging, host, device, or account-operation work.
- [ ] For every code gap, add a failing test and the smallest fix.
- [ ] Re-run the exact relevant focused gate after each fix.
- [ ] Finish with the repository-wide workflow and document unresolved external requirements.
