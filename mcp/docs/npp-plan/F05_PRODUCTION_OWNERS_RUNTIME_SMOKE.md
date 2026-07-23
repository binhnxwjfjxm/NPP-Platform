# NPP-F05 complete production-owner runtime smoke

> Source tooling only. This document is not production execution evidence and does not advance runtime coverage beyond 14/30.

## Command

```bash
npm run smoke:f05-production-owners
```

The command verifies standalone order creation; route create/update; session open, customer status, close/update and empty delete; route-customer update; route and route-customer archive; and canonical 404 responses for the seven retired legacy settings POST routes.

Every persisted-idempotent mutation must prove first execution, same-key replay, different-payload conflict, canonical envelope, exact persisted execute/replay request IDs, trusted context, one completed idempotency record, append-only succeeded/replayed audit events, and its business invariant. Archive evidence is separate: intent, target-scoped storage claims, provider R2 presence/absence, retry/reclaim, completion, and finalizer must each pass. PostgreSQL and R2 are separate systems and must never be described as one transaction.

## Mandatory guard

The command refuses to start unless all values are explicitly present and identities match. R2 credentials and target-scoped archive-proof capability are preflighted before the first temporary fixture mutation:

```bash
export NPP_F05_RUNTIME_SMOKE_GUARDED=I_UNDERSTAND_TEMPORARY_PRODUCTION_MUTATIONS
export NPP_F05_EXPECTED_INSTALLATION_ID='<approved installation UUID>'
export NPP_F05_EXPECTED_NPP_CODE='<approved NPP code>'
export MCP_INSTALLATION_ID='<must equal expected installation UUID>'
export MCP_NPP_CODE='<must equal expected NPP code>'
export MCP_API_BASE_URL='https://<approved Foundation gateway>'
export BACKEND_API_TOKEN='<private backend token>'
export SUPABASE_URL='https://<approved project>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<private service role key>'
export R2_ENDPOINT='https://<approved account>.r2.cloudflarestorage.com'
export R2_BUCKET_NAME='<approved bucket>'
export R2_ACCESS_KEY_ID='<private R2 access key>'
export R2_SECRET_ACCESS_KEY='<private R2 secret key>'
```

`CLOUDFLARE_R2_ENDPOINT` may be used instead of `R2_ENDPOINT`. Never paste this command with real values into CI logs, issues, PRs, chat, or shell history. Output redacts token-shaped errors and never includes provider object keys.

## Fixture boundary and cleanup

* All names/notes use `__NPP_F05_RUNTIME_SMOKE__` and dates use year 2099.
* IDs are captured only from responses created by this run. Existing routes, customers, sessions, orders and media are never selected as mutation targets.
* Archive retry/reclaim helpers must claim only the exact captured temporary `mediaId` and `deleteJobId`; broad batch claims are forbidden.
* Cleanup runs from `finally`, archives only captured temporary route IDs, and then checks temporary rows, outlet-media references, and every exact captured R2 object are absent.
* A failed cleanup makes the whole command fail. It is forbidden to manually delete unrelated production data to make evidence green.
* Archive PASS requires ordered observed facts for intent claim, persisted storage-worker failure, retry claim, target-scoped reclaim, provider delete, storage completion and finalizer.

## Evidence

Stdout is one JSON object headed by:

```json
{
  "NPP_F05_PRODUCTION_OWNERS_RUNTIME_SMOKE": "PASS|FAIL",
  "operations": {},
  "retiredSettingsPosts": {},
  "archiveLifecycle": {},
  "cleanup": {}
}
```

Do not record runtime `30/30` unless a guarded authenticated production run returns PASS, its cleanup is independently verified, and the evidence is reviewed. Codex must only run contract tests and builds; it must not run this production command, deploy, apply migrations, or run `pullmcp`.
