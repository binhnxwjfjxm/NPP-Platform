# Phase 5.7 — Supplier Purchase Pricing and PO Price Visibility

## Status

Source decision record for Issue #114 and Draft PR #115.

This slice closes the purchase-price and monetary-visibility gap before Phase 6 source mutation. It does not claim that migration `036` has run in production or that the source branch has been deployed.

## Domain ownership

Product, SKU and unit identity remain canonical shared master data.

```text
shared product / SKU / unit identity
├── pricing       sales and output prices
└── purchasing    supplier purchase prices
```

Supplier purchase prices belong to `purchasing`. Existing Sales Pricing lists, including `BASE`, channel, customer, customer-group, promotion and custom lists, are not purchase-price sources and must never be used as a fallback.

`GET /api/purchase-orders/sku-search` remains an identity and eligibility endpoint. It does not return a purchase or sales amount.

## Purchase-price key and resolution

A purchase price is scoped by:

```text
installation
+ supplier
+ SKU / variant
+ purchase unit
+ currency
+ effective date
+ minimum quantity tier
```

Resolver inputs are server validated:

```text
supplierId
variantId
unitId
quantity
currencyCode
orderDate
```

Among active rows valid on the document date and with `min_quantity <= quantity`, resolution is deterministic:

1. highest qualifying `min_quantity`;
2. latest `effective_from`;
3. stable row ID tie-break.

The migration prevents an exact duplicate business key. No historical or sales-price row is copied into the purchase-price table.

## Purchase Order behavior

### Automatic supplier-price resolution

A caller may create or update a Purchase Order line using SKU identity, quantity and note only. The backend resolves the purchase price using the Purchase Order supplier, document date and currency plus the SKU purchase unit and line quantity.

The resolved amount is snapshotted into `purchase_order_lines.unit_price` together with narrow provenance:

```text
purchase_price_id
purchase_price_source = SUPPLIER_PRICE
purchase_price_resolved_at
supplier_sku_snapshot
```

Changing the master price later never recalculates an existing Purchase Order.

### Manual override

Manual price entry remains available only when the request principal has:

```text
core.purchase-order.price.read
core.purchase-order.price.override
```

A manual price must be greater than zero and include a non-empty reason. It is snapshotted as:

```text
purchase_price_source = MANUAL_OVERRIDE
purchase_price_id = null
purchase_price_override_reason = required
```

Changing a Purchase Order price never changes the supplier purchase-price master.

### Missing and zero prices

A line with no resolvable supplier price fails atomically with `SUPPLIER_PURCHASE_PRICE_NOT_FOUND` unless an authorized principal supplies a valid manual override.

A zero price is rejected. Free goods and promotional purchase policy are outside this slice and must not be represented by zero.

Submit and approve fail closed when any line is unresolved or non-positive. Approval also requires price-read permission; blind financial approval is forbidden.

## Permissions and redaction

Canonical permissions:

```text
core.supplier-purchase-price.read
core.supplier-purchase-price.manage
core.purchase-order.price.read
core.purchase-order.price.override
```

Purchase Order create/update permissions do not imply monetary visibility or override permission.

When a principal lacks `core.purchase-order.price.read`, public Purchase Order API projection omits:

```text
unitPrice
discountMode
discountValue
discountAmount
taxRate
taxAmount
lineTotal
subtotal
discountTotal
taxTotal
total
purchasePriceId
purchasePriceSource
purchasePriceResolvedAt
supplierSkuSnapshot
priceOverrideReason
```

The safe response may expose only a non-monetary status such as `RESOLVED` or `NOT_FOUND`. Amounts must not be returned as zero, encoded metadata, error details or hidden DOM attributes.

Audit and outbox keep the authorized internal business snapshot. They are not exposed through the ordinary Purchase Order response projection.

## Core web behavior

The supplier purchase-price workspace is separate from Sales Pricing and supports supplier, SKU/unit, currency, price, minimum quantity, effective range, supplier SKU, source reference, note and active state.

The Purchase Order editor has two monetary modes:

- supplier price: server resolved, read-only in the editor;
- manual override: enabled only with override permission and always requires a reason.

For a quantity-only permission set, the editor renders SKU, unit, conversion, quantity, note and a safe price status without placing monetary values into client state.

## Current web-auth boundary

At this source checkpoint, the Core `/login` route is a presentation-only page and same-origin web gateways authenticate to Core API with the server-owned bootstrap token. A real end-user session and principal-forwarding boundary is not yet active.

Therefore this slice proves:

- direct Core API authorization and response redaction with custom principals;
- permission-aware UI/component contracts;
- no spoofable client role/header workaround.

It does not claim that distinct real-user roles are already active through the production browser gateway. Live per-user browser enforcement becomes effective only when a server-owned authenticated session supplies the actual principal to Core API. Backend redaction remains deny-by-default and ready for that boundary.

## Migration

Migration:

```text
036_supplier_purchase_pricing
```

It adds the purchase-price table, permission catalog entries and Purchase Order line provenance columns. Existing Purchase Orders remain readable; rows are not backfilled with invented prices or provenance.

Production rollout requires the normal separate operation: provider audit, fresh backup, restore rehearsal, migration apply/rerun/verify, reconciliation, backend-first deploy and smoke verification.

## Explicit non-scope

- Sales-price changes or purchase fallback to Sales Pricing
- RFQ and quotation comparison
- Purchase requisition workflow
- Supplier invoice matching or three-way match
- Free-goods purchase policy
- FX conversion
- Costing, FIFO or moving-average valuation
- End-user authentication/session implementation
- MCP changes or cutover
- Production migration, deployment or manual SQL
