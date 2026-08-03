# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline `main`: `a5d83e6dab410f431b7f5b9da281ae536b7605b2`.
- Phase 6C.1B merged through PR #185; Issue #172 is complete.
- Source merge does not prove production deployment, provider configuration, backup, migration, reconciliation or traffic cutover.
- Exact provider, release, backup and production-migration state must be audited separately before any production operation.

## Active work

```text
Issue #186 — Phase 6C.2 — MCP official NPP Sales Order adapter
Draft PR #187
Branch agent/phase-6c2-mcp-sales-order-adapter
Baseline main@a5d83e6dab410f431b7f5b9da281ae536b7605b2
```

## Product behavior locked for Phase 6C.2

```text
save MCP purchase demand
-> employee explicitly sends customer verification/open-code request
-> Core returns approved or linked_existing customer/address references
-> employee explicitly opens the NPP order step
-> MCP backend submits one draft Sales Order to Core
-> Core validates Sales SKU, unit, warehouse, customer, address and calculates price/tax
-> MCP stores and displays the Core order projection
```

- Existing MCP route/session/customer behavior remains intact.
- `Thêm khách` remains field-outlet-only and has no automatic Core side effect.
- MCP's legacy product source is not used for this flow; selectable Sales SKUs come from NPP Core.
- Only `approved` and `linked_existing` onboarding states can create an official order.
- The browser calls MCP only. MCP calls Core with a dedicated service principal.
- The created Core Sales Order remains `draft`; MCP cannot confirm, amend, cancel, reserve stock, create delivery, or settle it.
- Source identity is stable: `source_type=MCP`, `source_id=MCP order ID`, and the MCP outlet reference.
- Retry with the same demand is idempotent; changed payload under the same demand conflicts.
- MCP PWA icons are generated as square 192/512 and maskable icons from the existing NPP logo asset; no new image is generated.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                        MERGED
6C.0B provider-neutral persistence boundary                 MERGED
6C.0C backend writes/auth/idempotency/audit-outbox contract MERGED
6C.0D PostgreSQL mcp schema and write repositories          MERGED
6C.0E backup/restore/migration rehearsal source             MERGED
6C.0F provider/cutover preparation source                   MERGED
6C.1A Core customer verification foundation                 MERGED
6C.1B MCP request/status sync from order intent              MERGED — PR #185
6C.2  MCP official NPP Sales Order adapter                   ACTIVE — PR #187
```

## Production boundary

No production deploy, production migration, database-plan change, provider attachment or credential change is authorized by Issue #186 or PR #187.

The separate MCP Heroku Essential-tier credential-policy decision remains deferred and must not be mixed into Phase 6C.2 source behavior.

> Updated: `2026-08-03`
> Current checkpoint: Phase 6C.2 source implementation and CI on Draft PR #187.
