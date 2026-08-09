# Desktop OCR Routing and Lease Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavior and keep database/security changes in small reviewable migrations.

**Goal:** Add the database contracts needed to route OCR jobs to a trusted desktop worker and lease them safely, without exposing device secrets, service-role credentials, Gemini credentials, or Google Drive refresh tokens to the worker/browser.

**Scope:** This slice is backend/database foundation only. It does **not** implement the desktop binary, model download/execution, source-byte delivery, pairing UI, systemd service, or final local-result submission. Those build on these contracts later.

**Architecture:** Existing jobs remain Gemini by default. A new `ocr_route` distinguishes `gemini` from `desktop`; desktop-routed queued work enters `waiting_desktop`. Registered worker devices are service-private rows holding only a one-way credential digest plus capability/health metadata. Browser code gets safe device metadata through an authenticated RPC, never direct table access. Service-role-only claim/renew/expiry RPCs lease one waiting desktop job with a random lease id and bounded expiry, using `FOR UPDATE SKIP LOCKED` so multiple workers cannot claim the same job. Existing Gemini completion must fail closed for desktop-routed jobs.

## Security invariants

- Keep the worker completely free of service-role keys, Gemini API keys, and Drive refresh tokens.
- Store only a 32-byte credential digest in PostgreSQL; raw device credentials live only in the worker keyring and the pairing response that created them.
- Do not grant `authenticated` direct `SELECT/INSERT/UPDATE/DELETE` on the device table because even a credential digest is backend-only metadata.
- Only safe device fields may cross the authenticated list RPC.
- Claim/renew/expire RPCs are `service_role` only; `anon` and `authenticated` must have no execute privilege.
- Browser route changes may only affect the caller's own job and may never steal or clear a live desktop lease.
- Lease ownership is the tuple `(job_id, device_id, lease_id)` plus an unexpired timestamp. Device id alone is never sufficient authorization for completion later.
- A stale device/lease must never complete, renew, or mutate a job after expiry/reclaim.
- Existing jobs backfill to `gemini`; no migration may silently reroute current work to desktop.
- New `SECURITY DEFINER` functions use `set search_path = ''` and explicit execute revocation/grants.
- `waiting_desktop` must be introduced in a migration separate from migrations that consume the new enum value, avoiding PostgreSQL's unsafe-new-enum-value transaction trap.

---

### Task 1: Specify routing, device privacy, and lease behavior as RED

**Files:**

- Add: `tests/unit/ocr/desktop-ocr-routing-sql.test.ts`
- Add: `supabase/tests/desktop_ocr_routing.sql`

- [ ] Require a two-step migration sequence: enum value first, schema/functions after.
- [ ] Require `public.ocr_route` with exactly `gemini | desktop` semantics and a non-null `ocr_jobs.route` defaulting to Gemini.
- [ ] Require `ocr_worker_devices` with owner identity, label, active/revoked shape, 32-byte credential digest, capability object, timestamps, and composite owner key.
- [ ] Require device table privileges to remain service-private.
- [ ] Require an authenticated safe-list RPC that omits `credential_hash`.
- [ ] Require desktop lease fields on `ocr_jobs` and a composite FK binding lease device to the same user.
- [ ] pgTAP: existing/new jobs default to Gemini and remain compatible with current OCR behavior.
- [ ] pgTAP: authenticated users cannot read/write the raw device table or execute service-only lease RPCs.
- [ ] pgTAP: safe-list RPC returns only the caller's non-secret device metadata.
- [ ] pgTAP: two claims cannot lease the same job; the first active device owns it until expiry/release.
- [ ] pgTAP: stale/mismatched device or lease id cannot renew.
- [ ] pgTAP: expiry returns an abandoned processing job to `waiting_desktop` without changing its route.
- [ ] Commit RED contracts before GREEN migrations.

### Task 2: Add route/status primitives and service-private device registry

**Files:**

- Add: `supabase/migrations/202608081022_desktop_ocr_status_enum.sql`
- Add: `supabase/migrations/202608081023_desktop_ocr_devices_and_route.sql`

**Schema outline:**

- `alter type public.ocr_status add value if not exists 'waiting_desktop'`
- `create type public.ocr_route as enum ('gemini', 'desktop')`
- `ocr_jobs.route public.ocr_route not null default 'gemini'`
- `ocr_worker_devices.id uuid primary key default gen_random_uuid()`
- `ocr_worker_devices.user_id uuid not null`
- `ocr_worker_devices.label text not null`
- `ocr_worker_devices.credential_hash bytea not null unique check (octet_length(...) = 32)`
- `ocr_worker_devices.status text not null check (status in ('active','revoked'))`
- `ocr_worker_devices.capabilities jsonb not null default '{}'::jsonb`
- `last_seen_at`, `revoked_at`, `created_at`, `updated_at`
- composite unique `(id, user_id)`

- [ ] Keep device table RLS enabled but grant no direct authenticated table privilege.
- [ ] Add a status-shape constraint requiring `revoked_at` iff status is revoked.
- [ ] Add safe authenticated `list_ocr_worker_devices()` returning only id/label/status/capabilities/last_seen/revoked/created/updated fields.
- [ ] Add service-role-only registration/revocation primitives only if required by pgTAP; raw credential generation remains an Edge/pairing concern, not SQL.
- [ ] Add indexes for owner/status and last-seen lookup.
- [ ] Commit schema/device registry separately from lease functions.

### Task 3: Add desktop job routing and renewable lease contracts

**Files:**

- Add: `supabase/migrations/202608081024_desktop_ocr_job_leases.sql`

**Job fields:**

- `desktop_lease_device_id uuid null`
- `desktop_lease_id uuid null`
- `desktop_lease_expires_at timestamptz null`
- `desktop_lease_started_at timestamptz null`

- [ ] Add an all-null/all-present lease-shape constraint.
- [ ] Bind `(desktop_lease_device_id, user_id)` to `(device.id, device.user_id)`.
- [ ] Add route/status invariants so Gemini jobs never carry desktop lease state.
- [ ] Add authenticated owner-only `set_ocr_job_route(page_id, route)` that switches only safe unleased states: `queued → waiting_desktop` and `waiting_desktop → queued`.
- [ ] Refuse route changes for terminal/running jobs or any live desktop lease.
- [ ] Add service-role-only `claim_desktop_ocr_job(user_id, device_id, lease_id, lease_seconds)` using `FOR UPDATE SKIP LOCKED`, oldest-first deterministic ordering, bounded lease duration, and active-device validation.
- [ ] Add service-role-only `renew_desktop_ocr_job_lease(job_id, device_id, lease_id, lease_seconds)` requiring an unexpired exact owner tuple.
- [ ] Add service-role-only `expire_desktop_ocr_job_leases()` that clears only expired desktop leases and returns jobs to `waiting_desktop`.
- [ ] Keep attempt counters provider-independent; claim may increment the existing attempt counter only if that matches current retry semantics.
- [ ] Commit route and lease behavior in small checkpoints.

### Task 4: Guard Gemini completion from desktop-routed jobs

**Files:**

- Add: `supabase/migrations/202608081025_guard_gemini_completion_route.sql`
- Extend: `supabase/tests/desktop_ocr_routing.sql`

- [ ] Preserve the current public `complete_ocr_job(...)` signature used by the Gemini Edge Function.
- [ ] Add a preflight owner/job-route check before the existing completion transaction: only `route = 'gemini'` may use this entry point.
- [ ] A desktop-routed job must fail before page summary/history mutation even if the caller otherwise owns the page.
- [ ] Do not create the local-worker completion RPC yet; that later RPC must validate `(device_id, lease_id, expiry)` and persist provider=`local` into `ocr_results` atomically.
- [ ] pgTAP proves Gemini completion still works for the default route and rejects desktop route without altering page/job/result state.
- [ ] Commit the completion guard independently.

### Task 5: Validate and checkpoint

**Files:**

- Update: `docs/CURRENT_STATUS.md`
- Update: `docs/READINESS.md`
- Add: `docs/checkpoints/2026-08-08-desktop-ocr-routing-lease-foundation.md`
- Update this plan.

- [ ] Run same-SHA lint/check/unit/build/source/E2E/Edge gates through the toolchain.
- [ ] Run clean Supabase reset + full pgTAP including the new routing suite.
- [ ] Regenerate database types only from the validated clean applied schema; do not hand-edit the provisional mirror to simulate this gate.
- [ ] Record clearly that device pairing, worker source delivery, local model execution, heartbeat endpoint, completion/failure endpoint, keyring, spool, systemd and GPU benchmark remain unimplemented.

### Follow-up after this slice

The next slice should implement the authenticated pairing + device-authenticated Edge boundary and source-delivery contract. Only after that boundary is proven should the desktop process/backend (CPU first, then optional Vulkan/RX 6600) be implemented.
