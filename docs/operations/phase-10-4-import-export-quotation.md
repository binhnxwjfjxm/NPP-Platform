# Phase 10.4 — Import/Export, inventory stocktake file flow and quotation

Status: implementation contract for Phase 10.4.

## Locked boundaries

- Reuse existing product import (`POST /api/products/import`) and pricing import (`POST /api/pricing/import`).
- SKU is the user-facing stable key for file updates; immutable IDs stay internal.
- Inventory actual-count files never mutate `inventory.inventory_balances` directly. They create/count a stocktake and stop before submit/approve/post. Posting remains the existing `STOCKTAKE_ADJUSTMENT` ledger lifecycle.
- Explicit manual deltas remain the existing Manual Adjustment workflow; signed client deltas are not introduced.
- Opening balance remains its existing separate workflow.
- Quotation is an export/build surface using canonical `/api/pricing/resolve`; it does not introduce a second pricing engine or an accounting document lifecycle.
- Official file operations write metadata to the existing `reporting.import_export_jobs` history.
- No schema/provider/production mutation in this source slice.

## Scope

1. Reusable safe XLSX/CSV tabular utility for Core web file workflows.
2. Product/SKU import + export with SKU-stable flat workbook mapping into the existing canonical nested product import.
3. Pricing item import + export with SKU + price-list identity, mapping into the existing canonical pricing import.
4. Stocktake workbook export/import: warehouse/location/SKU/lot/actual-count; import creates and counts a stocktake only.
5. Inventory reporting movement timeline with signed per-SKU deltas and source-document drill-down metadata.
6. Sales quotation workspace and XLSX/CSV export using the existing pricing resolver for selected SKU/category/all and channel/customer-group/customer context.
7. Compact file controls and selectable export columns.
8. Canonical import/export history recording for completed/failed official file operations.
9. Regression/API/browser coverage; exact-head CI must be green before merge.
