# Issue 107 — Production UX closure plan

> Status: implementation in progress
> Base: `b78d862e9e51a18d44079a99a80e80805611ec8b`
> Safety: source only; no production deploy, migration, provider mutation, or `mcp/**` changes.

## Acceptance scope

### Product lifecycle

- Preserve dependency and stale-version details through same-origin gateways.
- Render actionable Vietnamese conflict guidance for products, categories, brands, SKUs, units, and barcode/unit assignment screens.
- Rejected mutations must not change visible row state.

### Purchase-order editor

- Keep capability-safe handling for old backends.
- Compact the order-information area and move secondary fields behind an optional-details control.
- Give SKU discovery and results the dominant workspace area.
- Keep quick search, catalog browse, and bulk entry as equal modes.
- Keep selected lines, totals, and save actions visible and responsive.

### Pricing resolution

- Preserve error code, status, retryability, and details in the web client.
- Provide actionable guidance for missing base price, mismatched customer group, missing unit/conversion, and non-priceable SKU.
- Reset stale errors/results when pricing context changes.

### Multi-SKU pricing

- Exact SKU price-list items remain canonical.
- Provide searchable/filterable multi-selection, explicit selected count, select-all-for-filter, preview, and skip/update conflict policy.
- Fixed direct prices must support per-SKU values; percentage/amount adjustments may share a value.
- Bulk persistence must be atomic and idempotent.

## Merge gate

- Focused API and web contract tests.
- Browser E2E for product conflict guidance, purchase-order layout/search fallback, pricing resolution guidance, and multi-SKU setup.
- Exact-head GitHub Actions success before merge.
