# Shared Browser Exclusion Design

## Goal

Guarantee that OCR jobs, image imports and PDF imports have the same cross-tab exclusion behavior in browsers with or without the Web Locks API.

## Architecture

A focused module, `src/lib/import/browser-exclusive.ts`, owns browser lock acquisition. It accepts an operation name and executes a task under:

1. `navigator.locks` with `ifAvailable: true` when supported;
2. otherwise, a `localStorage` lease derived from the operation name.

The existing `BrowserOcrQueueCoordinator` keeps queue state publication but delegates exclusion to this module. Image and PDF queues replace their private Web Locks-only helpers with the shared coordinator.

## Lease Contract

- Storage key is `${operationName}-lease`.
- Owner token is stable for the coordinator instance.
- Duration is 15 seconds, renewed every 5 seconds.
- A 50-millisecond settling window resolves simultaneous localStorage writes.
- A live foreign lease rejects acquisition.
- Release and renewal occur only while the current owner still holds the lease.
- Malformed records fail closed.
- Inaccessible storage preserves single-context execution rather than disabling imports.

## Boundaries

The module does not know about OCR, files, sessions or Svelte state. Callers provide a unique operation name and an async task. The module returns whether the task acquired exclusion.

## Testing

- Generic coordinator tests prove Web Locks preference and all lease behaviors.
- OCR coordinator tests continue proving state-channel integration through delegation.
- Source contracts prove both import queues use the shared helper and no longer contain private Web Locks fallbacks.
- Full CI remains authoritative for TypeScript, unit tests, build, browser, Edge and database gates.
