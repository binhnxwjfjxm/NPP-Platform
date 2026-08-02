# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited `main`: `188165fe9c8de84291015a1fa4564c15180399ee`.
- Phase 6C.1A Core customer-onboarding foundation merged through PR #153.
- PR #179 restored the loadable guarded MCP Heroku workflow and is included in the audited baseline.
- Exact provider, release, backup and production-migration state must still be audited separately before any production operation.

Source merge does not prove production deployment, provider configuration, backup, migration, reconciliation or traffic cutover.

## Active work

```text
Issue #172 — Phase 6C.1B — sync Core customer verification from MCP order flow
Draft PR #185
Branch agent/phase-6c1b-mcp-onboarding-sync
Baseline main@188165fe9c8de84291015a1fa4564c15180399ee
```

## Product behavior locked for Phase 6C.1B

`Thêm khách` remains an MCP field-outlet action only:

```text
add outlet to route/session
-> use for field visits, GPS, photos, tests, reports and follow-up
-> no automatic Core request
-> no automatic official customer code
```

Core submission begins only from a real purchase-demand/order-intent flow:

```text
save MCP purchase demand
-> employee explicitly sends verification/open-code request
-> MCP backend calls canonical Core onboarding API
-> MCP stores request status and Core customer/address references
-> official Sales Order remains Phase 6C.2
```

The browser never calls Core directly. MCP may submit and read its request but may not review, approve, link-existing or reject it.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                        MERGED
6C.0B provider-neutral persistence boundary                 MERGED
6C.0C backend writes/auth/idempotency/audit-outbox contract MERGED
6C.0D PostgreSQL mcp schema and write repositories          MERGED
6C.0E backup/restore/migration rehearsal source             MERGED
6C.0F provider/cutover preparation source                   MERGED
6C.1A Core customer verification foundation                 MERGED
6C.1B MCP request/status sync from order intent              ACTIVE — PR #185
6C.2  MCP official Sales Order adapter                       NOT STARTED
```

## Active implementation boundary

Phase 6C.1B adds:

- explicit MCP order-flow submission and status synchronization;
- dedicated Core service authentication with submit/read permissions only;
- deterministic demand idempotency and changed-snapshot conflict;
- structured MCP order columns through migration `mcp_006_customer_onboarding_sync`;
- storage of approved/linked Core customer and address IDs;
- all seven Core lifecycle statuses in MCP UI;
- NPP/Hùng Phát logo for MCP shell and PWA identity.

No source in `McpSessionAddCustomerButton.tsx` or its add-customer proxy may gain a Core side effect.

## Production boundary

No production deploy, production migration, database-plan change, provider attachment or credential change is authorized by this task.

The separate MCP Heroku deploy workflow currently has an Essential-tier credential-policy decision that the owner explicitly deferred. Do not mix that deployment decision into Phase 6C.1B source behavior.

> Updated: `2026-08-03`
> Current checkpoint: Phase 6C.1B source implementation and CI on Draft PR #185.
