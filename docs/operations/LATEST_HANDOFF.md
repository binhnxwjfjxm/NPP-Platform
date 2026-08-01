# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact source baseline for Phase 6C.0A: `46f43b473e35ac1103aa2b49412de3f64fe1646b`.
- PR #128 merged the Core employee-directory refresh fix at the same commit.
- The source delta after the earlier MCP audit did not modify `mcp/**`.
- Phase 6B.2 commercial controls are on `main`; production migration `040_sales_order_commercial_controls.sql` remains a separate operation and is not assumed to have run.

## Active Phase 6C.0A work

Issue:

```text
#129 — Phase 6C.0A — Audit MCP legacy dependencies, identity mapping and cutover contracts
```

Branch:

```text
agent/phase-6c0-mcp-legacy-audit
```

Scope is docs/tests/read-only only:

```text
machine-readable dependency inventory
live-call graph contract
environment contract inventory
identity mapping contract
legacy-order classification contract
read-only data-audit SQL
fixture and reconciliation report schema
risk register
documentation hygiene
```

No runtime behavior, provider configuration, production database access, migration, deploy or cutover is authorized by this branch.

## Locked MCP conclusions

MCP is not a browser-direct Supabase mutation application in the active flow. The current runtime is:

```text
MCP UI
→ Next server/API proxy
→ Foundation Gateway
→ typed/transitional handler or legacy internal fallback
→ Supabase REST/RPC
```

The gateway boundary, request context and several idempotent mutation patterns are valid foundations to preserve.

MCP is not yet provider-neutral because:

- frontend production build still requires Supabase URL and anon/publishable key;
- backend still requires Supabase URL and service-role key;
- legacy internal server remains a startup dependency;
- application handlers still know provider RPC/table contracts;
- current actor is a fixed proxy service actor;
- user/employee authentication and deny-by-default MCP authorization are not complete.

## Customer and order boundary

- `shared.customers.id` remains the canonical Core customer identity.
- MCP field outlet remains a separate identity.
- Field outlet may have nullable Core customer/address links.
- Unlinked outlet may be visited, tested, surveyed and followed up.
- Only a linked active Core customer may create an official Core Sales Order.
- Legacy MCP `orders`/`order_items` are not automatically Core Sales Orders.

Every legacy order must be classified into exactly one of:

```text
OFFICIAL_ORDER_MIGRATION_CANDIDATE
FIELD_ORDER_INTENT
SAMPLE_TEST_DEMAND
HISTORICAL_DISPLAY_ONLY
INVALID_ORPHAN_RECONCILIATION_REQUIRED
```

Bulk import of the legacy order table into `sales.sales_orders` is forbidden.

## Current production evidence boundary

Verified earlier in this chat:

- Vercel production has a deployment sourced from `46f43b473e35ac1103aa2b49412de3f64fe1646b`.
- Public `/login` and a Next static asset responded successfully.
- Protected Core routes required authentication.
- Authenticated employee-directory workflow was manually tested by the owner and considered temporarily acceptable.

Still not assumed or claimed:

- exact Heroku Core release after the latest frontend deployment;
- migration 040 registry state;
- Sales Order `entry-settings` recovery;
- production backup and restore rehearsal;
- MCP Heroku/VPS/Supabase/R2 runtime state;
- production data reconciliation;
- Phase 6C cutover readiness.

## Phase 6C sequence

```text
6C.0A repository/data contract audit
→ 6C.0B provider-neutral boundary
→ 6C.0C backend-owned write hardening
→ 6C.0D PostgreSQL mcp schema
→ 6C.0E migration rehearsal
→ 6C.0F provider/cutover preparation
→ 6C.1 customer onboarding bridge
```

Do not start Phase 6C.1 before the identity, SKU/unit, order classification, auth/permission and provider/runtime gates are closed.

## Required workflow

1. Recheck exact `main` before PR.
2. Keep changes under docs/tests/read-only audit scope.
3. Run exact PR-head CI.
4. Review findings honestly; do not manufacture defects when source is correct.
5. Merge only after CI/review gate.
6. Production deploy, migration and provider operations remain separate explicit commands.

> Updated: `2026-08-01`  
> Current checkpoint: Phase 6C.0A audit implementation on Issue #129.
