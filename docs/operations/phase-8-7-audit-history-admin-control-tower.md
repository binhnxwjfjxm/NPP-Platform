# Phase 8.7 — Audit, Import/Export history & Admin Control Tower

Status: source implementation for Issue #382. Parent: #367.

## Source-of-truth

- Business activity history reads the existing append-only `shared.core_audit_records` ledger.
- Phase 8.7 introduces `reporting.import_export_jobs` as the canonical metadata history for authorized import/export jobs.
- Existing browser CSV/download behavior and legacy MCP exports are not backfilled and are not represented as official history.
- Admin Control Tower is a projection only. It does not own business state or KPI SQL.

## Control Tower contract

`GET /api/reporting/control-tower` reuses the existing Phase 8 report functions for sales, purchasing, inventory, aging, gross margin, employee/MCP, logistics and COD. The response exposes only approved management summaries. Detailed arrays remain on their NPP report routes.

Employee/MCP remains field-scoped by its canonical resolver. If that scope cannot be resolved, Control Tower returns a family warning instead of broadening access.

COD reuses Phase 8.6 `codReport`; Admin receives custody-by-currency plus boolean warning signals for pending handover, discrepancy, overdue promise and lineage/lifecycle exceptions. Admin does not define a second COD query.

## History APIs

- `GET /api/reporting/audit-history`
- `GET /api/reporting/import-export-history`

Both are installation-owned, read-only, `no-store`, default to the current business month, cap a page at 200 rows and use descending `(timestamp, uuid)` keyset cursors. Audit list responses intentionally omit `before_data` and `after_data`; the list exposes trace metadata and whether change snapshots exist.

Import/export history never returns `result_object_key`; the list exposes only result presence and checksum identity.

## Permissions

Migration 070 registers, without role grants:

- `core.reporting.audit-history.read`
- `core.reporting.control-tower.read`
- `core.reporting.export`

Bootstrap receives these operational/reporting permissions through the existing Core service-principal pattern. `core.reporting.control-tower.read` does not grant detailed report permissions; NPP drill-down routes authorize independently.

## UI boundary

NPP Operations owns detailed history screens:

- `/operations/audit-history`
- `/operations/import-export-history`

Admin MCP/NPP `/` becomes the responsive Control Tower. It renders management KPI/warning summaries and links to NPP Operations for COD, inventory, logistics, aging, employee/MCP, audit and import/export history. Admin does not copy those detailed report tables or mutation workflows.

## Money, currency and time

- money stays exact decimal strings end to end;
- Control Tower never sums across `currency_code`;
- business timezone remains `Asia/Ho_Chi_Minh`;
- current-snapshot semantics from inventory/aging/COD remain those of their canonical report contracts.

## Production boundary

This source slice does not authorize deployment or production migration. Migration 070 must pass clean apply + rerun verification in CI before any later production rollout gate.
