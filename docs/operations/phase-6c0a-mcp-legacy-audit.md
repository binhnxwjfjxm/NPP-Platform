# Phase 6C.0A — MCP Legacy Dependency, Identity and Cutover Audit

> Status: **ACTIVE IMPLEMENTATION AUDIT — DOCS/TESTS/READ-ONLY ONLY**  
> Issue: `#129`  
> Branch: `agent/phase-6c0-mcp-legacy-audit`  
> Baseline: `main@46f43b473e35ac1103aa2b49412de3f64fe1646b`  
> Date: `2026-08-01`

## 1. Purpose

This slice turns the Phase 6C repository audit into reviewable, machine-readable contracts before any MCP provider-neutral runtime change.

It does not authorize:

- production database access or mutation;
- Supabase, VPS, Heroku, Vercel or R2 configuration changes;
- PostgreSQL `mcp` schema creation;
- data migration, cutover or shutdown;
- MCP-to-Core official Sales Order creation;
- changes to the existing MCP user interface or business behavior.

## 2. Baseline and source delta

The original repository audit was closed against an earlier `main` checkpoint. Before opening this branch, `main` was re-audited at:

```text
46f43b473e35ac1103aa2b49412de3f64fe1646b
```

The intervening source changes were confined to NPP Core Sales commercial controls and the Core employee directory. No `mcp/**` source changed in that delta. Therefore the MCP repository conclusions remain materially applicable, while provider state and production data remain unverified.

## 3. Locked architecture

```text
5 Vercel frontend projects
2 Heroku backend services
1 PostgreSQL installation
```

MCP and Core remain separate business owners:

- MCP owns field routes, field outlets, sessions, visits, tests, reports, follow-ups and field media.
- Core owns official customers, canonical SKU/unit, Sales Orders, inventory, delivery/logistics and accounting.
- A field outlet is not automatically a Core customer.
- A legacy MCP order is not automatically a Core Sales Order.
- Supabase/VPS are legacy MCP sources, not the target backend architecture.

## 4. Repository-verified active call graph

The active visits flow is:

```text
src/app/visits/page.tsx
→ src/features/mcp/MCPPage.tsx
→ src/features/mcp/MCPPageEntryReportReady.tsx
→ src/features/mcp/McpSessionCompactView.tsx
→ src/features/mcp/McpSessionCompactViewFinal2.tsx
```

The active mutation boundary is:

```text
MCP client component
→ idempotentMutationFetch()
→ /api/backend/[...path]
→ proxyBackendRequest()
→ Foundation Gateway
→ typed order/route handler
   or transitional handler
   or legacy internal fallback
→ Supabase REST/RPC
```

The current gateway is a strangler boundary, not a completed provider-neutral backend. `bootstrap.js` starts the legacy internal server and waits for its health before exposing the public gateway. `gateway.js` falls back to that internal server when typed and transitional handlers do not accept a route.

## 5. Current strengths that must be preserved

- active MCP mobile UI and field workflow;
- Next server proxy;
- stable public API error normalization;
- request ID and installation context;
- idempotent retry helper and RPC-backed mutation patterns;
- no browser service-role credential;
- backend-owned R2 presign flow;
- direct mutation scanner and retirement contracts;
- gateway strangler strategy during incremental replacement.

## 6. Current blockers

Phase 6C.1 remains blocked by:

1. no complete legacy user → canonical employee/user mapping;
2. no locked legacy route customer → `mcp.field_outlet` migration mapping;
3. no complete field outlet → Core customer/address reconciliation;
4. no complete legacy product/item → canonical SKU/unit mapping;
5. no five-way legacy-order classification report;
6. provider-specific REST/RPC knowledge in current runtime;
7. legacy monolith fallback;
8. frontend production build dependence on Supabase variables;
9. fixed service actor instead of authenticated employee context;
10. no deny-by-default MCP permission matrix;
11. no verified production provider/runtime audit;
12. no verified backup, restore rehearsal, reconciliation or rollback evidence.

## 7. Machine-readable package

This slice adds:

```text
mcp/audit/phase-6c0a/dependency-inventory.json
mcp/audit/phase-6c0a/environment-contract.json
mcp/audit/phase-6c0a/identity-mapping-contract.json
mcp/audit/phase-6c0a/legacy-order-classification.json
mcp/audit/phase-6c0a/risk-register.json
mcp/audit/phase-6c0a/read-only-data-audit.sql
mcp/audit/phase-6c0a/reconciliation-report.schema.json
mcp/audit/phase-6c0a/fixtures/reconciliation-input.json
```

Every dependency entry records current owner, target owner, classification, evidence level and next audit step. An `unknown` is acceptable only when it has an explicit owner and next step.

## 8. Environment contract

The current MCP frontend production build still requires:

```text
BACKEND_API_BASE_URL
BACKEND_API_TOKEN
MCP_LEGACY_ACTOR_ID
SUPABASE_URL
SUPABASE_ANON_KEY
```

The current MCP backend still requires provider-specific Supabase configuration and supports only the `proxy-service` authentication mode. R2 configuration is optional and backend-only.

The environment inventory contains variable names and classifications only. It contains no values.

## 9. Identity mapping contract

The locked mapping sequence is:

```text
legacy user
→ canonical employee/user

legacy route customer
→ mcp.field_outlet

mcp.field_outlet
→ nullable Core customer
→ nullable Core customer address

legacy product/item
→ nullable canonical SKU/unit

legacy order
→ exactly one legacy-order classification
```

Name-only matching is forbidden. Historical visits remain attached to the field outlet identity after linking.

An unlinked outlet may still be visited, tested, surveyed and followed up. It may not create an official Core Sales Order.

## 10. Legacy-order classification

Every legacy order must be classified into exactly one class:

1. `OFFICIAL_ORDER_MIGRATION_CANDIDATE`
2. `FIELD_ORDER_INTENT`
3. `SAMPLE_TEST_DEMAND`
4. `HISTORICAL_DISPLAY_ONLY`
5. `INVALID_ORPHAN_RECONCILIATION_REQUIRED`

Ambiguous records default to reconciliation required. Bulk import into `sales.sales_orders` is forbidden.

## 11. Read-only data audit

`read-only-data-audit.sql` is prepared for review but is not executed by this slice.

It includes queries for:

- duplicate outlet phone;
- duplicate outlet name/address candidates;
- orphan route, session and outlet references;
- invalid lifecycle status;
- orders without customer/outlet/session identity;
- orders without items;
- possible retry duplicates;
- items without SKU/unit evidence;
- nullable or ambiguous customer identity;
- sample/test/order-intent mixing;
- source row counts.

The script starts an explicit read-only transaction and ends with rollback. Production execution requires a separate operation with verified provider, backup and restore-rehearsal gates.

## 12. Idempotency evidence boundary

The current helper preserves one key across automatic retries inside a single invocation. It creates a new key when called again without an explicit key.

Therefore:

```text
automatic network retry in one call
= repository verified

manual retry after ambiguous response
= not yet proven

refresh/remount retry
= not yet proven
```

This is a contract gap to test in a later hardening slice, not proof of an existing duplicate production incident.

## 13. Risk gates

The risk register explicitly covers:

- dual write;
- legacy fallback;
- provider outage;
- identity collision;
- ambiguous legacy order;
- retry duplicate;
- stale frontend environment;
- service actor attribution;
- R2 orphan object;
- cutover rollback.

No cutover slice may start until its relevant risk gates have evidence.

## 14. Acceptance for Phase 6C.0A

This slice is accepted when:

- machine-readable contracts parse;
- active call graph source contracts pass;
- repository-verified evidence paths exist;
- no unknown lacks an owner and next step;
- environment inventory contains no values;
- legacy order classes are exactly the locked five;
- SQL remains read-only;
- fixture and report schema remain aligned;
- exact PR-head CI is green;
- no runtime behavior, provider or production state changes.

## 15. Next sequence

```text
6C.0A repository/data contract audit
→ 6C.0B provider-neutral boundary
→ 6C.0C backend-owned write hardening
→ 6C.0D PostgreSQL mcp schema
→ 6C.0E migration rehearsal
→ 6C.0F provider/cutover preparation
→ 6C.1 customer onboarding bridge
```

Production rollout remains a separate explicitly authorized operation.
