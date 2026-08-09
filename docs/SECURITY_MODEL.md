# Security model

This document records security boundaries that are expected to remain true as the Fichário Virtual evolves. The automated source gates under `tools/checks/` enforce the mechanically verifiable parts of this model.

## Trust boundaries

- Supabase authentication identifies the active user. Database RLS and private Storage policies are the server-side authorization boundary; client-side filtering is never an authorization control.
- Correction drafts may contain document text. Browser drafts are therefore namespaced by authenticated user and page (`fichario:correction-draft:v2:<userId>:<pageId>`), the serialized owner is checked on read, and legacy unscoped v1 records are never rendered.
- Google Drive OAuth credentials and provider access tokens must not be persisted in document records, local draft records, URLs, logs, or build artifacts.
- Desktop OCR workers authenticate through the dedicated worker boundary. Service-role credentials remain server-side; worker-facing RPCs use the lease/source binding defined by the desktop OCR migrations and shared auth helpers.

## PDF boundary

PDF input is untrusted content.

- `pdfjs-dist` is pinned to a patched release and guarded by `tools/checks/check-dependency-security.mjs`.
- The application uses PDF.js display APIs to load and rasterize pages; it does not instantiate the PDF.js viewer scripting manager or JavaScript-action APIs.
- `tools/checks/check-pdfjs-security.mjs` rejects PDF scripting-manager/JSActions usage in application source.
- The deployed CSP must retain an explicit `script-src` that does not allow `unsafe-eval`, `unsafe-inline`, wildcard, or `data:` script sources. `wasm-unsafe-eval` is intentionally distinct and is required for the WASM PDF inspection path.

## Local browser state

- Any local state that can contain user or document data must include the authenticated user identifier in its storage boundary and validate that owner before returning data.
- Account switching must not expose local state created by another account on the same browser profile.
- Broadcast messages carry identifiers/status only; document text, file names, OAuth tokens, OCR provider secrets, and signed URLs must not be broadcast.

## GitHub Actions and dependencies

- External GitHub Actions in this repository are pinned to immutable 40-character commit SHAs. Moving tags such as `@v4`, `@main`, and `@latest` are rejected by `tools/checks/check-workflow-security.mjs`.
- Checkout credentials are not persisted unless a narrowly scoped workflow explicitly requires a write operation.
- Workflow permissions are explicit and least-privilege; `pull_request_target`, `write-all`, `secrets: inherit`, and direct `curl | shell` execution are rejected by the workflow security gate.
- High/critical dependency advisories are checked in the external `Offline-Toolchains` validation path against the regenerated/frozen pnpm dependency tree.
- Security-sensitive dependency floors are also encoded locally so a vulnerable rollback fails source gates even without network access.

## Validation

The security-relevant baseline is validated by:

1. `pnpm verify` for formatting, linting, type checking, unit tests, and production build.
2. `pnpm test:source:offline` for tracked-secret, workflow, dependency, PDF, source, database-migration, OCR, and routing invariants.
3. `pnpm test:e2e` for browser behavior.
4. `pnpm test:functions:check` for Supabase Edge Functions.
5. `pnpm test:db:local` for local database/RLS gates.
6. The `Offline-Toolchains` Fichário workflow, which checks out an exact commit and runs the complete verification with pinned tool versions.
7. An isolated CodeQL JavaScript/TypeScript `security-extended` pass in `Offline-Toolchains`; findings are reviewed before being treated as vulnerabilities.

## Repository-level settings

Some controls are outside application source. GitHub repository administration must still enable and verify branch protection for `main`, Dependabot alerts/security updates, and secret-scanning/push-protection where available. These administrative controls are tracked separately so merging code does not create a false impression that they are enabled.
