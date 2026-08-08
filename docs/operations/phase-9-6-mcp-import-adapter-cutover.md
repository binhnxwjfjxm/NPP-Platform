# Phase 9.6 — MCP import + adapter replacement + dual verification

> Issue: #393  
> Parent: #386  
> Baseline: `main@9ed63840b56bd91ea82b976df920786bf905f8b2`  
> Production mutation: **NOT AUTHORIZED BY THIS SOURCE SLICE**

## Current truth

Production MCP source already fails closed to PostgreSQL in `NODE_ENV=production`, and the normal bootstrap uses the typed PostgreSQL/Core runtime when legacy runtime is disabled. The remaining legacy Supabase code is not a production authority and Phase 9.5 uses a separate read-only audit/export path.

The owner stated on 2026-08-08 that current MCP legacy data consists only of a few test entries with no important operational value. Phase 9.6 therefore supports a **zero-operational-import fast path**, but it does not turn that statement into an unbound blanket delete rule.

## Test-only zero-import rule

The owner decision must be bound to the exact Phase 9.5 snapshot by:

- exact `installationId`;
- exact `manifestSha256`;
- policy `TEST_ONLY_ARCHIVE_NO_OPERATIONAL_IMPORT`.

Before accepting that policy, Phase 9.6 verifies the Phase 9.5 manifest self-hash plus classification/findings counts and hashes. If the snapshot changes, the decision no longer matches and the gate fails.

With the bound test-only policy:

- records previously marked `operational_import` are retained as archive evidence only;
- reconciliation-required test records are also retained as archive evidence only;
- **no legacy row is imported into canonical production**;
- cross-installation/source-boundary defects still block the gate.

If the owner later chooses `IMPORT_OPERATIONAL`, the normal Phase 9.5 `importReady=true` gate remains mandatory and reconciliation-required rows block import.

## Runtime decommission gate

After the data decision is bound to real evidence, production closure requires:

- canonical runtime provider = PostgreSQL;
- `DATABASE_URL` and `PERSISTENCE_PROVIDER` remain required runtime config names;
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MCP_LEGACY_RUNTIME_ENABLED` are no longer required production runtime variables;
- MCP customer/onboarding bridge verified end-to-end;
- MCP -> Core Sales Order bridge verified end-to-end;
- retry/idempotency verified with no duplicate.

This is a provider evidence gate. Source code does not pretend those production config removals or live bridge smokes have already happened.

## Why no heavy importer is added now

A generic production importer would add unnecessary mutation surface when the owner has explicitly classified the current legacy dataset as non-important test data. The source supports both paths:

1. the intended zero-import/archive path for the current installation; and
2. the normal operational-import path if the eventual Phase 9.5 snapshot proves real records must be preserved.

The choice is evidence-bound, not inferred from names or row contents.

## Remaining gates before Phase 9.6 production closure

1. Run the real Phase 9.5 read-only snapshot against the historical MCP source.
2. Record the resulting exact manifest hash and installation ID.
3. Bind the owner test-only policy to that exact snapshot.
4. Verify runtime config-name readback and the three bridge/idempotency smokes.
5. Only then may a separate explicit production command remove legacy provider requirements/cut over any remaining provider configuration.

No DNS/frontend cutover, manual SQL, production import, deployment, or provider mutation is performed by this source slice. Issue #391 deferred Cloudflare lifecycle evidence and Issue #392 snapshot evidence remain independent open gates until actually completed.
