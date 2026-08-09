# Desktop OCR Device Authentication Boundary Plan

**Goal:** Turn the service-private desktop device registry into a usable authentication boundary without exposing service-role, Gemini, or Drive credentials to the worker.

## Scope

This slice implements database identity primitives and thin Edge adapters for pairing/authentication/claim/renew/source metadata. It does not implement local OCR execution or desktop completion.

## Invariants

- Raw device credential is generated once at the Edge pairing boundary and returned once; only SHA-256 digest is stored.
- Device lookup by digest is service-role only.
- Pairing requires a normal authenticated/authorized app user.
- Revocation is owner-only and atomically invalidates active leases by returning affected desktop jobs to `waiting_desktop`.
- Worker endpoints authenticate the raw credential before any job metadata is returned.
- Source metadata is returned only for an exact unexpired `(job, device, lease)` tuple.
- Source resolution returns the private storage path/mime metadata to the server-side Edge adapter; it never returns Google tokens or service credentials.
- All service-only RPCs explicitly revoke `public`, `anon`, and `authenticated` execute.

## Tasks

### 1. RED contracts
- [ ] Add static SQL contracts for register/authenticate/revoke/source RPCs.
- [ ] Add pgTAP for digest privacy, owner revocation, lease invalidation, and stale source denial.

### 2. Device identity RPCs
- [ ] Add service-only `register_ocr_worker_device(user,label,digest_hex,capabilities)`.
- [ ] Add service-only `authenticate_ocr_worker_device(digest_hex)` returning only active device/user metadata.
- [ ] Add authenticated owner-only `revoke_ocr_worker_device(device_id)` that marks the device revoked and requeues its active desktop jobs.

### 3. Lease-bound source metadata
- [ ] Add service-only `get_desktop_ocr_job_source(job,device,lease)`.
- [ ] Require active device, exact unexpired lease, desktop route and processing status.
- [ ] Return only page/job/source identifiers needed by the Edge adapter.

### 4. Edge adapters
- [ ] Add shared raw-device credential parser/hash helper with strict base64url length validation.
- [ ] Add authenticated pairing endpoint that generates 32 random bytes, stores only SHA-256 digest via RPC and returns the raw credential once.
- [ ] Add worker claim/renew endpoints that authenticate the device before service-only lease RPCs.
- [ ] Add source endpoint that authenticates device and resolves lease-bound private source metadata before retrieving bytes or issuing a short-lived server-controlled delivery.
- [ ] Add Deno/source-security tests and no-store/CORS behavior.

### 5. Validate/checkpoint
- [ ] Full same-SHA toolchain including clean Supabase + pgTAP.
- [ ] Record that local completion/model/keyring/systemd remain pending.
