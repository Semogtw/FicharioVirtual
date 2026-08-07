# Supabase/Postgres best-practices audit — 2026-08-07

## Scope

This checkpoint records a repository + live staging review using the Supabase/Postgres best-practices guidance, with emphasis on RLS, privilege boundaries, migration-history integrity, foreign-key indexing and deploy reproducibility. The audit ran while `main` was also receiving concurrent Drive/PDF work, so changes were kept in small isolated commits and live migration work was applied strictly in repository order.

## Findings and fixes

### 1. Authenticated table privileges were broader than the application contract

Supabase default ACLs had left `authenticated` with administrative privileges such as `TRUNCATE`, `TRIGGER`, `REFERENCES` and `MAINTAIN` on application tables. RLS protects row-oriented operations but does not make those privileges part of the intended browser capability boundary.

`202608070008_harden_authenticated_database_privileges.sql`:

- removes those privileges from current `public` application tables;
- removes them from future `public` table defaults of the migration role;
- preserves table-specific CRUD contracts instead of re-granting broad DML;
- restores `usage_daily` to `SELECT`-only for authenticated clients.

Live catalog verification after deployment found zero remaining administrative privileges in that set for `authenticated`.

### 2. SECURITY DEFINER use was reduced to deliberate capability boundaries

The following helpers operate on owner-scoped rows and no longer need elevation, so `070008` changes them to `SECURITY INVOKER`:

- `is_authorized_user()`;
- `clear_temporary_page_image(uuid, text)`;
- `complete_ocr_job(uuid, text, jsonb, text, timestamptz)`;
- `fail_ocr_job(uuid, text, text, boolean, timestamptz, timestamptz)`.

Privileged OCR RPCs that coordinate protected accounting, manifests or allowlist state remain `SECURITY DEFINER`. They are capability boundaries rather than convenience helpers.

`block_ocr_job_quota(...)` still needs privileged accounting access, but the audit found that it lacked the active-user allowlist guard. `070008` preserves elevation and adds `is_authorized_user()` before privileged state changes.

Drive worker SECURITY DEFINER functions remain service-only: execution is revoked from `public`, `anon` and `authenticated` and granted to `service_role` where required.

### 3. Staging migration drift was fully repaired

At the start of the audit, live staging ended at:

```text
202608060004_cover_drive_foreign_keys
```

while the repository had already advanced through the Drive-first, OCR-batch and large-PDF-reference migrations.

The missing migrations were applied one-by-one in canonical repository order through `202608070008_harden_authenticated_database_privileges`.

The connected migration action generates its own timestamp version. For this one-time recovery, every successful migration was therefore followed immediately by a transaction that changed only that migration-history row to the original Git version and asserted exactly one matching `(version, name)` row before proceeding. The final remote history was then re-read and contained no generated versions.

This recovery procedure is not the normal deployment path. Future deployments should use the protected CLI workflow and `supabase db push`, which preserves the versioned history directly.

### 4. Performance advisor found a real missing foreign-key index

After the schema was synchronized, the performance advisor reported an unindexed FK on the composite ownership reference:

```text
ocr_batches(document_id, user_id)
```

The existing `ocr_batches_document_idx(document_id, created_at)` did not cover that FK.

`202608070009_cover_ocr_batches_document_foreign_key.sql` adds:

```sql
create index ocr_batches_document_owner_idx
  on public.ocr_batches (document_id, user_id);
```

`supabase/tests/performance_contracts.sql` now locks that coverage in pgTAP. The first version of the test exposed a test-only `name[]` versus `text[]` comparison mismatch; the contract was corrected with an explicit `attname::text` cast before being treated as green.

After `070009` reached staging, the unindexed-FK advisor warning disappeared.

The remaining performance-advisor findings are `unused_index` informational results. No index was removed: staging is new/low-traffic and many indexes cover FK, queue and synchronization paths that need representative workload statistics before removal can be justified.

### 5. Edge runtime was materially behind the schema

Live staging initially had only two Edge Functions:

- `delete-document` v1;
- `process-ocr` v1.

Both were older than the repository. The old OCR runtime still used the application daily hard-limit contract, while the migrated database uses provider-authoritative quota plus OCR batches. The old deletion function also predated Drive-first deletion.

The runtime was synchronized so all eight versioned functions are now ACTIVE:

- `process-ocr` v2, JWT required;
- `delete-document` v2, JWT required;
- `drive-oauth-start` v1, JWT required;
- `drive-oauth-callback` v1, JWT disabled intentionally;
- `drive-access-token` v1, JWT required;
- `drive-resolve-folder` v1, JWT required;
- `drive-run-jobs` v1, JWT required;
- `drive-sync` v1, JWT required.

The callback is the sole unauthenticated Edge route because Google returns to it without the user's Supabase JWT. Its application-level authorization uses the one-time OAuth state/nonce flow. `tests/unit/tooling/supabase-edge-jwt-config.test.ts` now protects this exact policy.

No Edge Function runtime errors were present in the project logs immediately after deployment. Runtime publication does not by itself prove that every custom Google/Gemini secret is configured or that the real providers accept the credentials.

## Regression coverage

Live staging validation completed with:

- `supabase/tests/security_contracts.sql`: **47/47 pgTAP checks passed** inside a rollback transaction;
- `supabase/tests/performance_contracts.sql`: **1/1 pgTAP check passed**;
- security advisor: only the seven deliberate authenticated-executable OCR SECURITY DEFINER capability boundaries remain;
- performance advisor: the FK-without-index finding is gone; only unused-index informational findings remain.

Repository tooling now also covers:

- manual/protected staging deployment;
- read-only GitHub repository permissions;
- disabled persisted checkout credentials;
- pinned Supabase CLI;
- migration list + dry-run before `db push`;
- rejection of the `--include-all` shortcut;
- Edge Function deployment only after the database is synchronized;
- remote function listing after deployment;
- no global `--no-verify-jwt` override;
- exactly one JWT exception in `supabase/config.toml`: `drive-oauth-callback`.

## Deployment status

Live `fichario-staging` is synchronized through:

```text
202608070009_cover_ocr_batches_document_foreign_key
```

and its eight Edge Functions are ACTIVE.

`.github/workflows/deploy-supabase-staging.yml` now deploys both parts from one checkout:

1. link staging;
2. list migration drift;
3. run `db push --dry-run`;
4. apply `db push`;
5. confirm migration history;
6. deploy all versioned Edge Functions;
7. list deployed Edge Functions.

The workflow uses the per-function `verify_jwt` policy from `supabase/config.toml`; it must not use a global `--no-verify-jwt` override.

The remaining deployment-automation blocker is GitHub account configuration, not repository code. The repository currently has zero GitHub Environments configured. Before the workflow can run with administrative credentials, create/protect `staging-deploy` and provide:

- secret `STAGING_SUPABASE_ACCESS_TOKEN`;
- secret `STAGING_SUPABASE_DB_PASSWORD`;
- variable `STAGING_SUPABASE_PROJECT_REF`.

The connector used for this audit does not expose Edge Function secret enumeration. Therefore the custom runtime values required by Google/Gemini integrations must still be confirmed through the normal Supabase secret-management path before provider-level staging validation.

## Follow-up

The database/schema audit itself is no longer blocked by migration drift. Remaining Supabase-oriented work is operational validation:

1. configure/protect the GitHub `staging-deploy` environment so future deployments are reproducible from Git;
2. confirm required custom Edge Function secrets without printing them;
3. run the remote Auth/RLS/Storage staging gate with dedicated synthetic accounts;
4. exercise Google OAuth/Drive and Gemini OCR against staging credentials;
5. rerun security/performance advisors after representative workload exists before considering any unused-index removal.
