# Supabase/Postgres best-practices audit — 2026-08-07

## Scope

This checkpoint records a repository + live staging review using the Supabase/Postgres best-practices guidance, with emphasis on Security/RLS and privilege boundaries. The audit was performed while `main` was receiving concurrent Drive/PDF work, so database changes were kept isolated in a new migration and committed in small checkpoints.

## Findings

### 1. Authenticated table privileges were broader than the application contract

Supabase's default ACLs for new `public` tables grant the API roles a broad privilege set. Existing migrations already narrowed CRUD in several places, but the live staging catalog still showed `authenticated` with administrative privileges including `TRUNCATE`, `TRIGGER`, `REFERENCES`, and `MAINTAIN` on application tables.

RLS protects row-oriented operations, but it does not protect `TRUNCATE`. These privileges are therefore outside the intended client capability boundary even when PostgREST does not expose every SQL operation directly.

`202608070008_harden_authenticated_database_privileges.sql` now:

- removes those four administrative privileges from all current `public` application tables;
- removes them from the migration role's future `public` table defaults;
- preserves existing table-specific CRUD contracts rather than broadly re-granting DML;
- restores `usage_daily` to `SELECT`-only for `authenticated` clients.

### 2. Several SECURITY DEFINER functions did not need elevation

The live Supabase advisor reported authenticated-executable `SECURITY DEFINER` functions. A warning is not automatically a vulnerability: some OCR RPCs intentionally act as capability boundaries because direct writes to accounting or protected state are forbidden.

The following helpers operate only on rows already protected by owner RLS and do not require elevated table privileges, so migration `070008` changes them to `SECURITY INVOKER`:

- `is_authorized_user()`
- `clear_temporary_page_image(uuid, text)`
- `complete_ocr_job(uuid, text, jsonb, text, timestamptz)`
- `fail_ocr_job(uuid, text, text, boolean, timestamptz, timestamptz)`

The security contract now tests this explicitly.

### 3. Remaining privileged OCR RPCs are deliberate capability boundaries

Some RPCs must remain `SECURITY DEFINER` because authenticated clients are not allowed to directly mutate the protected state they coordinate:

- `claim_ocr_job(...)` updates quota/accounting state and already checks the active-user allowlist;
- `record_ocr_consent(integer)` updates the allowlist row while clients otherwise have read-only access;
- batch registration/call/finish/recovery RPCs coordinate `ocr_batches` and `usage_daily`, whose direct writes are restricted by later hardening migrations.

`block_ocr_job_quota(...)` also needs privileged accounting access, but the audit found that its latest source definition checked `auth.uid()` without checking `is_authorized_user()`. Migration `070008` preserves `SECURITY DEFINER` and adds the missing active-user allowlist guard. The security contract records both the intentional elevation and the required guard.

Drive worker `SECURITY DEFINER` functions were also reviewed: the worker-side functions revoke execution from `public`, `anon`, and `authenticated`, granting execution only to `service_role`, so their elevated role remains intentional.

### 4. Unused-index advisor results are not actionable yet

The performance advisor currently reports unused indexes in staging. No index was removed as part of this audit. The environment is new and low-traffic, so zero/low usage is not sufficient evidence that an index is redundant; many of the indexes cover FK, queue, synchronization, and expected production access paths.

Index removal should wait for representative workload statistics and query-plan evidence.

### 5. Live staging is behind repository migrations

The staging migration history currently trails the repository's migration set (including the newer OCR batch and Drive PDF reference work). Because of that drift, migration `070008` was **not** applied directly to staging out of order.

Instead, its SQL was executed inside a transaction against the live catalog and rolled back. The rehearsal confirmed:

- zero unexpected `SECURITY DEFINER` functions among the four converted helpers;
- `block_ocr_job_quota` remains `SECURITY DEFINER` and contains the allowlist guard;
- zero `public` application tables retain `TRUNCATE`, `TRIGGER`, `REFERENCES`, or `MAINTAIN` for `authenticated`;
- `usage_daily` remains readable but not writable by `authenticated`.

The migration should reach staging through the normal ordered migration synchronization path.

## Regression coverage

`supabase/tests/security_contracts.sql` now covers:

- invoker status for helpers that should rely on RLS;
- explicit definer status for privileged OCR capability boundaries;
- the allowlist guard in privileged quota blocking;
- absence of administrative table privileges for `authenticated`;
- read-only client access to `usage_daily`.

## Deployment status

A second live migration-history check confirmed that `fichario-staging` is currently applied only through `202608060004_cover_drive_foreign_keys`, while the repository is versioned through `202608070008_harden_authenticated_database_privileges`. That leaves **24 repository migrations pending** on staging.

The remaining step is operational rather than a missing schema change. The safe path is:

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase migration list --linked
supabase test db
```

The repository currently has no versioned deploy workflow with the administrative Supabase credentials required by `db push`; the existing staging verification workflow intentionally uses only public credentials. The Management API migration helper was not used as a substitute because it would register generated migration versions rather than preserve the repository's existing migration numbers. Likewise, applying only `070008` would put the live schema out of order.

`docs/SUPABASE_STAGING.md` now records the ordered deployment contract so a future manual or protected CI deploy cannot silently fork migration history.

Until those 24 migrations are pushed in order, the live security advisor is expected to continue reporting the seven authenticated-executable `SECURITY DEFINER` functions present in the older schema. The performance advisor also reports unused-index informational findings; those remain intentionally unchanged until representative workload statistics justify removals.

## Follow-up

After the ordered `db push`, rerun `supabase migration list --linked`, the database tests, and the Supabase security/performance advisors. Expected authenticated-executable `SECURITY DEFINER` warnings should then be limited to deliberate capability-boundary RPCs; each remaining warning should be reviewed against its execution grants and authorization guard rather than suppressed globally.
