# Phase 6B.2 — Sales Order Commercial Controls Hardening

> Status: **ACTIVE IMPLEMENTATION CONTRACT**  
> Issue: `#126`  
> Source baseline: `main@1915e8653c77a8cab03a11d66de25976ad09dd5d`  
> Production deploy/migration: **NOT AUTHORIZED**

## 1. Goal

Complete the Sales Order commercial-control boundary as one reviewed Core vertical slice:

```text
migration
-> pricing resolver
-> Sales Order repository/service
-> Core API and same-origin gateway
-> NPP operations UI
-> browser and PostgreSQL verification
```

The slice adds an installation-owned sales channel, explainable system-price provenance, permissioned manual final-price override, document-level supplemental discount allocation, preview/save consistency checks and real browser scroll evidence.

## 2. Locked boundaries

- Work only in `npp-core/**`, `database/**`, shared Core packages and active operations documents.
- `mcp/**` must remain unchanged.
- Core is authoritative for customer/group/channel context, pricing, discount allocation, tax and totals.
- The browser never sends authoritative base price, tax amount, line total or document total.
- No production deployment, production migration, provider mutation or secret change is authorized.
- Fulfillment, inventory reservation, delivery, dispatch, receivable, payment, COD, e-invoice and Phase 6C are excluded.

## 3. Sales channel

Every newly created manual Sales Order requires `salesChannelId`.

Entry settings return active installation-scoped channels and an optional installation default. When no active default exists, the user chooses explicitly. Core rejects an inactive, missing or cross-installation channel.

The aggregate and every commercial version snapshot:

```text
sales_channel_id
sales_channel_code_snapshot
sales_channel_name_snapshot
```

Changing customer, channel, quantity or effective pricing time invalidates the previous preview and reprices every affected line.

Walk-in customers still use channel and promotion context, but never customer/customer-group context.

## 4. System price and manual final-price override

The pricing resolver always computes the automatic system price first using canonical context:

```text
installation
variant and sell unit
quantity
currency and effective timestamp
sales channel
customer and canonical customer group when applicable
priority, effective dates and quantity tiers
EXCLUSIVE/STACKABLE and stop-processing
```

A manual override is applied only after that automatic resolution. It requires `core.sales-order.price.override` and a non-empty line-specific reason.

Every version line snapshots:

```text
base_unit_price
system_unit_price
unit_price                 # final price
price_source
price_list_id
price_rule_id
manual_override_reason
pricing_trace_snapshot
```

The UI displays base, system and final price separately and provides `Dùng lại giá hệ thống`. Base price is never editable.

## 5. Preview/save consistency

Pricing preview returns a deterministic resolution fingerprint derived from canonical pricing context, base/system price and ordered applied/skipped steps.

Draft save and confirmation re-resolve with the same canonical context. The client sends the expected system price and/or fingerprint for each line. If the automatic result changed, Core returns `SALES_PRICE_CHANGED` with affected line details. It never silently replaces a reviewed commercial result.

A manual override remains visible against the newly resolved system price and must be reviewed again after a mismatch.

## 6. Supplemental document discount

The ordinary manual-order UI does not expose additional per-line discount entry. Pricing lists and promotions remain part of the system unit price.

A separate footer control supports:

```text
NONE
PERCENT
TOTAL_AMOUNT
```

A positive document discount requires:

```text
core.sales-order.discount.override
non-empty document_discount_reason
```

The intent is snapshotted on the version:

```text
document_discount_mode
document_discount_value
document_discount_reason
```

Core allocates the target discount to eligible positive-gross lines by gross proportion using deterministic largest remainder:

1. calculate each floor allocation with integer/BigInt arithmetic;
2. order remaining cents by descending fractional remainder;
3. break ties by ascending line number;
4. never allocate to a zero-gross line;
5. never allocate more than line gross;
6. recompute line tax after allocation using HALF_UP;
7. calculate document totals as the sum of rounded line facts.

A payload containing positive document discount and positive legacy line discount fails with `MIXED_DISCOUNT_SCOPE`. Historical versions with line discounts remain readable and immutable.

## 7. Authorization and audit

Minimum relevant permissions:

```text
core.sales-order.price.override
core.sales-order.discount.override
core.sales-order.confirm
```

UI permission wiring is convenience only. Core remains deny-by-default and records actor, request ID, channel, manual reason, document-discount intent and resulting snapshots in audit/outbox payloads.

## 8. UI contract

Desktop order entry remains near full screen at `1366x768`:

- header and footer remain available;
- `.orderEditorBody` is the sole vertical scroll owner;
- `min-height: 0`, `overflow-y: scroll` or equivalent and `scrollbar-gutter: stable` are present;
- `scrollTop` changes when scrolling to the last line and back;
- no whole-modal horizontal overflow occurs.

Each compact line shows SKU/unit, quantity, base price, system price, applied-pricing summary, final price, line amount and override state. Details show ordered applied/skipped trace and tax facts.

## 9. Migration

Add and register:

```text
database/migrations/sales/040_sales_order_commercial_controls.sql
```

The migration is forward-only, rerun-safe and PostgreSQL 17 compatible. Existing rows remain valid with nullable channel/default facts; confirmed history is not rewritten or fabricated.

## 10. Required verification

Backend and migration verification covers channel scopes, customer/group/channel/promotion resolution, manual override permission/reason/snapshots, pricing mismatch, largest-remainder allocation, inclusive/exclusive tax after discount, mixed-scope rejection and historical reads.

Web verification covers channel selection/repricing, pricing trace, manual override/reset, document-discount footer, absence of the new per-line discount editor and mismatch review.

Chromium E2E at `1366x768` proves body scroll, fixed header/footer actions, no horizontal overflow, draft save and permissioned confirm.

Source completion additionally requires exact-head CI green and `mcp/** changed files = 0`.
