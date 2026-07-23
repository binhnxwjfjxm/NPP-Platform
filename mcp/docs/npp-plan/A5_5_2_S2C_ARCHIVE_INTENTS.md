# A5.5.2 — S2c cross-system archive intents

> Date: 2026-07-20  
> Phase: Phase A / NPP-F05 / A5.5.2  
> Scope: `POST /api/routes/:id/archive` and `POST /api/route-customers/:id/archive`

## Root cause

The current Foundation archive owner already deactivates the parent, creates one target-scoped storage delete job, claims private outlet media, deletes R2 objects, retries failed/stale work, and invokes the guarded PostgreSQL hard-delete owner only after no undeleted media remains.

The missing boundary is the public user intent. The current request is not persistently claimed by `Idempotency-Key`, is not linked to the target delete job as a first-class record, and has no persisted terminal response for replay after the asynchronous R2 boundary.

PostgreSQL and R2 are not one transaction. This slice must not present them as one.

## Public operations

```text
route.archive           POST /api/routes/:id/archive
route-customer.archive  POST /api/route-customers/:id/archive
```

## Architecture

```text
browser stable Idempotency-Key
-> authenticated Foundation request context
-> claim archive intent in PostgreSQL
-> exact intent / target / storage-delete-job linkage
-> existing resumable R2 deletion owner
-> guarded parent hard-delete finalizer
-> complete storage job and archive intent
-> persist canonical terminal response and append-only audit
```

## Invariants

1. One `(installation, operation, idempotency_key)` identifies exactly one request payload and target.
2. Same key and same payload replays the same intent and terminal response.
3. Same key with another target or payload returns conflict.
4. One active archive intent exists for one `(installation, target_type, target_id)`; another click cannot create a competing delete job.
5. The intent stores the exact `mcp_storage_delete_jobs.id` used by the R2 lifecycle.
6. R2 `404` remains idempotent delete success.
7. A failed object delete blocks parent hard-delete and leaves both job and intent resumable.
8. A worker crash during `deleting` or `finalizing` remains reclaimable by the existing cleanup owner.
9. Parent hard-delete only occurs after every target media row is `deleted`.
10. A missing parent during replay/finalization is treated as already completed only when the linked job/intent proves the same target archive.
11. Terminal success persists a neutral response containing target id, delete job id and deleted media count; it does not expose object keys or provider details.
12. Terminal failure stores a neutral error code and remains retryable; it does not mint a second intent.
13. Browser, anon and authenticated database roles cannot execute archive-intent RPCs or mutate intent/job tables directly.
14. Trusted request, installation and actor context comes from Foundation, never from the client body.
15. Claim races are serialized in a fixed order: idempotency key first, target second. This classifies concurrent same-key and same-target requests instead of leaking a provider unique violation.
16. Intent claim and delete-job claim are separate RPC transactions. If another request finishes the job inside that gap, a missing-parent response must re-read the persisted intent/job before returning an error.

## State model

```text
pending -> processing -> completed
                    \-> failed -> processing
```

`completed` is terminal. `failed` is resumable. Cleanup may reclaim a linked job without creating a new intent.

## Data contract

The archive intent persists:

```text
id
installation_id
operation
idempotency_key
request_hash/request_payload
target_type
target_id
delete_job_id
status
response_status
response_payload
last_error
attempt_count
request/finalize context
created_at/updated_at/completed_at
```

## Implementation order

1. Add archive-intent table, constraints, grants and typed service-role RPCs.
2. Pass Foundation `idempotencyKey` into the storage lifecycle context.
3. Serialize intent claims by key and target; link the exact intent from the storage-job trigger in the same PostgreSQL transaction that creates or updates that job.
4. Complete/fail the linked intent when the storage delete job reaches a terminal result.
5. Re-read the intent/job when parent deletion reports not-found across the two-RPC claim gap.
6. Make both browser callers use stable idempotent operations.
7. Add migration, owner, caller, replay/conflict, retry/reclaim and no-direct-provider contracts.
8. Run Foundation, backend, typecheck, production build and browser smoke.

## Non-scope

- no production migration apply;
- no VPS `pullmcp`;
- no Vercel production deployment;
- no change to `milktea-backend` or port `3002`;
- no new replace API;
- no claim that PostgreSQL and R2 are a shared transaction;
- no NPP-F06 or Order Core work in this slice.
