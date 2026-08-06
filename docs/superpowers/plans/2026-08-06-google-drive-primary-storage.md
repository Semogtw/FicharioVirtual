# Google Drive Primary Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Drive the permanent source of original files while Supabase remains responsible for metadata, OCR, search, synchronization state, and temporary processing artifacts.

**Architecture:** Add a Drive-specific domain boundary with strict parsers, a PostgreSQL synchronization model protected by RLS, and a browser/backend adapter split that never persists OAuth tokens in public tables or browser storage. Implement local contracts first, then connect the real Google API only after the external OAuth client and secrets exist.

**Tech Stack:** SvelteKit 5, TypeScript, Zod, Vitest, Supabase PostgreSQL/pgTAP, Supabase Edge Functions, Google Drive API v3, OAuth 2.0 `drive.file`.

## Global Constraints

- Continue on `main`, explicitly authorized by the user.
- Drive is the permanent authority for original images and PDFs.
- Supabase Storage is temporary/fallback only after migration.
- Use exactly `https://www.googleapis.com/auth/drive.file` for the MVP; do not broaden scope.
- Preserve OCR, corrections, tags, title, notebook, and search index when a physical file disappears.
- Use `drive_file_id`/`drive_folder_id` as identity, never names or paths.
- Keep jobs idempotent and resumable; one conflict must not block unrelated jobs.
- Do not persist OAuth tokens in localStorage, exports, logs, public tables, artifacts, or service-worker caches.
- Do not enable billing or paid fallback.
- Add behavioral tests before production code and commit each independently reviewable step.

---

### Task 1: Canonical documentation correction

**Files:**

- Modify: `docs/PROJECT_SPEC.md`
- Modify: `docs/READINESS.md`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `README.md`
- Create: `docs/GOOGLE_DRIVE_SETUP.md`

**Interfaces:**

- Consumes: approved design at `docs/superpowers/specs/2026-08-06-google-drive-primary-storage-design.md`.
- Produces: one canonical statement that Drive work is required and not yet externally complete.

- [ ] Replace the architecture statements that call Supabase Storage permanent with the Drive-primary split.
- [ ] Remove the incorrect 100% codifiable/96% MVP claim and list Drive implementation and external OAuth validation separately.
- [ ] Document the exact external Google Cloud setup without secret values.
- [ ] Run documentation validation.
- [ ] Commit the canonical correction.

### Task 2: Drive domain contracts — RED

**Files:**

- Create: `tests/unit/drive/contracts.test.ts`

**Interfaces:**

- Consumes: no production Drive code.
- Produces: failing tests specifying Drive IDs, files, changes, job state, conflict decisions, and missing-file reconciliation.

- [ ] Add tests that reject malformed/extra Google response fields and duplicate change IDs.
- [ ] Add tests that map removed Drive files to `missing` while preserving document metadata.
- [ ] Add tests that reconnect the same `drive_file_id` and isolate ambiguous conflicts.
- [ ] Add tests for exact `drive.file` authorization scope and root folder query construction.
- [ ] Run `pnpm test tests/unit/drive/contracts.test.ts` and require failure because the production modules do not exist.
- [ ] Commit the red tests.

### Task 3: Drive domain contracts — GREEN

**Files:**

- Create: `src/lib/drive/types.ts`
- Create: `src/lib/drive/contracts.ts`
- Create: `src/lib/drive/reconciliation.ts`
- Create: `src/lib/drive/queries.ts`

**Interfaces:**

- Produces:
  - `DRIVE_FILE_SCOPE` constant.
  - `parseDriveFile`, `parseDriveFileList`, `parseDriveChangePage`.
  - `reconcileDrivePresence(document, change)`.
  - `rootFolderQuery(name)` and `childFolderQuery(parentId, name)`.

- [ ] Implement only behavior required by the tests using strict Zod schemas.
- [ ] Freeze parsed domain values.
- [ ] Ensure removed changes never erase OCR/domain fields.
- [ ] Run the focused test and the complete Vitest suite.
- [ ] Commit the green implementation.

### Task 4: PostgreSQL synchronization model — RED

**Files:**

- Create: `supabase/tests/drive_sync.sql`

**Interfaces:**

- Consumes: current `app_users`, `notebooks`, `documents`, and RLS helper.
- Produces: failing pgTAP coverage for connection isolation, hierarchy, unique Drive IDs, missing-file preservation, idempotent jobs, and conflict isolation.

- [ ] Test that only the owner can read/write a Drive connection.
- [ ] Test nested notebooks cannot reference a parent owned by another user.
- [ ] Test Drive file/folder IDs are unique per owner.
- [ ] Test marking a file missing preserves document/pages.
- [ ] Test duplicate idempotency keys cannot create duplicate jobs.
- [ ] Run `pnpm test:db:local` and require failure because the migration does not exist.
- [ ] Commit the red database test.

### Task 5: PostgreSQL synchronization model — GREEN

**Files:**

- Create: `supabase/migrations/202608060001_google_drive_primary_storage.sql`
- Modify: `src/lib/types/database.ts`

**Interfaces:**

- Produces:
  - enums `drive_connection_status`, `drive_physical_state`, `drive_sync_status`, `drive_sync_operation`, `drive_conflict_kind`;
  - tables `drive_connections`, `drive_sync_jobs`, `drive_conflicts`;
  - hierarchical and Drive identity fields on `notebooks` and `documents`;
  - `mark_drive_file_missing`, `reconnect_drive_file`, `claim_drive_sync_job` RPCs;
  - RLS, indexes, triggers, grants, and strict constraints.

- [ ] Add schema changes without rewriting historical migrations.
- [ ] Make `documents.storage_path` nullable and describe it as temporary/fallback.
- [ ] Force RLS on all new public tables.
- [ ] Add owner-only policies using the existing allowlist contract.
- [ ] Add claim semantics with lease and retry fields.
- [ ] Update the provisional TypeScript schema mirror.
- [ ] Run database and TypeScript gates.
- [ ] Commit the schema implementation.

### Task 6: Synchronization service contracts — RED/GREEN

**Files:**

- Create: `tests/unit/drive/sync-service.test.ts`
- Create: `src/lib/drive/sync-service.ts`

**Interfaces:**

- Consumes: strict Drive parsers and a `DriveGateway` interface.
- Produces:
  - `synchronizeDriveChanges(options)`;
  - page-token advancement only after successful persistence;
  - isolated conflict recording;
  - retry-safe job outcomes.

- [ ] Write failing tests for pagination, no premature token advancement, removal, reconnection, and isolated conflicts.
- [ ] Implement the minimal gateway-driven synchronizer.
- [ ] Run focused and full Vitest gates.
- [ ] Commit service implementation.

### Task 7: Browser connection state and settings UI

**Files:**

- Create: `tests/unit/drive/connection-state.test.ts`
- Create: `src/lib/drive/connection-state.ts`
- Create: `src/lib/services/drive.ts`
- Create: `src/lib/components/DriveConnectionCard.svelte`
- Modify: `src/routes/settings/+page.svelte`
- Modify: `.env.example`
- Modify: `src/lib/env/public.ts`
- Modify: `tests/unit/env.test.ts`

**Interfaces:**

- Produces: visible disconnected/configuration-required/connected/syncing/error states without storing tokens.

- [ ] Add red tests for state parsing and optional Google client ID configuration.
- [ ] Implement the service and present status in Settings.
- [ ] Keep the connect action disabled with an explicit message until the OAuth backend/client is configured.
- [ ] Run focused tests, Svelte check, and build.
- [ ] Commit the UI foundation.

### Task 8: Real OAuth and Drive API adapter

**Files:**

- Create: `supabase/functions/drive-oauth-start/index.ts`
- Create: `supabase/functions/drive-oauth-callback/index.ts`
- Create: `supabase/functions/drive-access-token/index.ts`
- Create: `supabase/functions/_shared/google-drive-client.ts`
- Create: `tests/unit/drive/google-drive-client.test.ts`
- Modify: `tools/checks/check-edge-functions.sh`
- Modify: `docs/GOOGLE_DRIVE_SETUP.md`

**Interfaces:**

- Consumes: Google OAuth client ID/secret configured only in Supabase secrets.
- Produces: one-time state validation, refresh-token storage behind privileged backend access, ephemeral access-token broker, strict Drive API adapter.

- [ ] Add tests for authorization URL, state expiry/replay, token response parsing, and Drive response parsing.
- [ ] Implement start/callback/token functions with custom callback authentication and no secret exposure.
- [ ] Deploy only after external credentials exist.
- [ ] Run Deno checks and a staging OAuth smoke test.
- [ ] Commit code separately from external configuration evidence.

### Task 9: Resumable upload and explicit Drive import

**Files:**

- Create: `tests/unit/drive/resumable-upload.test.ts`
- Create: `src/lib/drive/resumable-upload.ts`
- Create: `src/lib/components/DriveImportButton.svelte`
- Modify: `src/routes/import/+page.svelte`
- Modify: image/PDF publication services to store `drive_file_id` before permanent completion.

**Interfaces:**

- Produces: resumable session state, chunk retry/resume, and explicit copy into the controlled root/caderno.

- [ ] Add failing tests for chunk boundaries, HTTP 308 progress, retry, expiry, and final file ID.
- [ ] Implement upload state without persisting access tokens.
- [ ] Add explicit “Importar do Drive” flow using selected files only.
- [ ] Keep Supabase originals as migration fallback until Drive confirmation.
- [ ] Run import queue, multi-tab, and build gates.
- [ ] Commit each queue integration independently.

### Task 10: End-to-end promotion and migration

**Files:**

- Add staging verification workflow/scripts.
- Update: `docs/READINESS.md`, `docs/CURRENT_STATUS.md`, `docs/RECOVERY.md`, `docs/FREE_TIER_OPERATIONS.md`.

**Interfaces:**

- Produces: evidence-backed migration from Supabase originals to Drive and eventual cleanup of permanent Storage copies.

- [ ] Validate OAuth, root folder, nested notebooks, upload, copy import, change feed, missing/reconnect, conflicts, and resumable upload.
- [ ] Migrate existing originals idempotently while preserving fallback until checksums/IDs are confirmed.
- [ ] Remove permanent Supabase copies only after Drive confirmation and rollback evidence.
- [ ] Test disconnect/reconnect, token revocation, backup, and rollback.
- [ ] Update readiness only for the exact green SHA.
