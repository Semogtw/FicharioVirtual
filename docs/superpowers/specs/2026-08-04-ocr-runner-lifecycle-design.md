# OCR Runner Lifecycle and Fallback Lease Design

## Goal

Keep pending OCR work progressing after the initial authentication bootstrap while preventing duplicate processing across browser tabs, including browsers without `navigator.locks`.

## Architecture

The existing `OcrJobRunner` remains responsible for bounded rounds, concurrency, backoff, cancellation and database-selected runnable jobs. Two browser-only adapters complete its lifecycle:

1. `BrowserOcrQueueCoordinator` keeps `navigator.locks` as the primary exclusion mechanism. When unavailable, it uses a short-lived `localStorage` lease with a unique owner token, an acquisition settling window, periodic renewal and owner-checked release.
2. `OcrQueueLifecycle` resumes the runner immediately after authorization and whenever the browser returns online, the document becomes visible, or a five-minute polling interval elapses while the tab is visible and online.

Authorization remains the outer boundary. `hooks.client.ts` starts the lifecycle only for an authorized session and stops it before pausing the queue after session loss.

## Lease Rules

- Storage key: `fichario-ocr-runner-lease`.
- Lease duration: 15 seconds.
- Heartbeat: every 5 seconds while work owns the lease.
- Acquisition settling window: 50 milliseconds before ownership confirmation.
- A non-expired lease owned by another tab rejects acquisition.
- Release removes the key only when it still belongs to the current owner.
- Storage parsing is fail-closed for malformed or incomplete lease records.
- When browser storage is unavailable, the coordinator preserves the current single-context behavior instead of blocking all work.

## Lifecycle Rules

- Poll interval: five minutes.
- Starting is idempotent and triggers one immediate resume attempt.
- `online` triggers a resume attempt.
- `visibilitychange` triggers only when the document is visible.
- Polling triggers only while visible and online.
- Stopping removes listeners and the interval; repeated stops are safe.
- Resume failures are contained because later lifecycle events can retry.

## Testing

- Coordinator unit tests cover active foreign leases, acquisition, contention during the settling window, owner-checked release and storage-unavailable behavior.
- Lifecycle unit tests cover immediate start, online, visibility, polling, idempotent start and complete cleanup.
- The hooks source contract proves authorization starts/stops the lifecycle and session loss still pauses active work.
- The full repository validation remains the authoritative gate.
