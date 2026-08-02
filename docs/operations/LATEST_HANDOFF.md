# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline before Phase 6C.1A: `7c082641d46bfbe22b9e68924641933864ee184b`.
- PR #130 merged Phase 6C.0A repository/data-contract audit.
- PR #136 merged Phase 6C.0B provider-neutral PostgreSQL persistence boundary.
- PR #142 merged the guarded MCP Vercel runtime-source contract.
- PR #144 merged Phase 6C.0C backend-owned writes, authorization, idempotency and audit/outbox contract.
- PR #146 merged Phase 6C.0D MCP PostgreSQL schema, migration runner and write repositories.
- PR #148 merged Phase 6C.0E disposable backup/restore rehearsal and reconciliation evidence.
- PR #150 merged Phase 6C.0F guarded provider/cutover preparation.
- Exact latest `main` must be re-audited before PR review, merge or any later operation.

Source merge does not prove production deployment, provider configuration, database attachment, backup, reconciliation, migration or cutover.

## Active work

Issue:

```text
#151 — Phase 6C.1A — connect the existing MCP “Add customer” flow to Core customer verification
```

Branch:

```text
agent/phase-6c1a-core-customer-onboarding
```

## Product behavior locked for Phase 6C.1

MCP Field is already a substantially complete field-sales application. Do not rebuild its routes, sessions, customer-entry form, GPS capture, outlet-photo capture or field workflow.

The existing MCP action remains the user entry point:

```text
Employee opens a route/session
-> taps “Thêm khách”
-> enters the outlet data already supported by MCP
-> MCP keeps the outlet in the route and active session
-> MCP backend sends the same outlet snapshot to Core for verification
-> Core reviewer creates a new official customer or links an existing customer
-> MCP receives the Core request status and, when approved, the official customer/address IDs and customer code
```

The existing component `mcp/src/features/mcp/McpSessionAddCustomerButton.tsx` already collects customer name, phone, area, address, note, GPS and photos. The existing frontend route proxies `/api/backend/mcp-day/session-customer/add` to the MCP backend. Phase 6C.1 must adapt these existing boundaries rather than introducing a replacement screen or parallel customer workflow.

Until Core approval/linking is complete, the outlet remains usable for field visits, tests, reports and follow-up, but cannot create an official Core Sales Order.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                        MERGED
6C.0B provider-neutral persistence boundary                 MERGED
6C.0C backend writes/auth/idempotency/audit-outbox contract MERGED
6C.0D PostgreSQL mcp schema and write repositories          MERGED
6C.0E backup/restore/migration rehearsal and reconciliation MERGED
6C.0F provider attachment and cutover preparation           MERGED
6C.1A existing MCP add-customer -> Core verification bridge ACTIVE
6C.1B Core review/status synchronization completion          NOT STARTED
6C.2  MCP official Sales Order adapter                       NOT STARTED
```

No production provider or database mutation is authorized.

## Locked runtime conclusions

The target installation topology remains five Vercel frontends, two Heroku backends and one shared PostgreSQL cluster.

The active MCP backend startup boundary remains:

```text
bootstrap.js
-> config.js
-> persistence.js
-> postgresql-adapter.js
-> gateway.js
```

Production does not fall back to Supabase. Protected field-domain routes remain fail-closed until reviewed repositories are implemented and explicitly cut over.

The default MCP service authorization policy remains empty. Browser headers cannot grant installation identity, employee identity, roles, permissions or scopes.

The production runtime connection must use a restricted MCP role. Production migration commands require a separate operator-only migrator credential. The migrator credential must not be stored in the `hung-phat-mcp` runtime environment.

Do not attach the shared PostgreSQL database, create production roles/grants, request a production backup, run production migrations, import legacy data, deploy `hung-phat-mcp` or switch field traffic without a separately approved operation.

## Separate MCP Vercel blocker

The guarded MCP Vercel production workflow still lacks safe GitHub Actions sources for these variable names:

```text
MCP_BACKEND_API_BASE_URL
MCP_BACKEND_API_TOKEN
MCP_SUPABASE_URL
MCP_SUPABASE_ANON_KEY
```

Do not rerun `/deploy-vercel-mcp-production` until their sources are recovered and configured. This blocker is separate from Phase 6C.1.

## Production evidence boundary

Not claimed or assumed:

- current MCP Heroku release or runtime configuration;
- current MCP Vercel deployment or environment state;
- current auto-deploy state at either provider without a fresh provider audit;
- shared PostgreSQL attachment to MCP;
- production `mcp` schema, runtime role, migrator role or grants;
- a current production backup;
- a restore rehearsal using a real production backup;
- production migration or live legacy-data reconciliation;
- Core migration production registry state;
- any backend deployment, field-handler switch or traffic cutover.

> Updated: `2026-08-02`  
> Current checkpoint: Phase 6C.1A product alignment on Issue #151.
