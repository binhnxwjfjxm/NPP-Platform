# Phase 3.3E — Price lists, channel resolution and promotions

> Status: implementation in progress on `agent/pricing-lists-channel-resolution`  
> Production deployment: excluded and intentionally deferred

## Purpose

Implement a data-driven pricing engine for exact sell-unit SKU identities without hardcoding retail, carton, channel, customer-group or promotional prices in application code.

The product variant/SKU remains the canonical sell unit. A base/retail SKU and a carton SKU may have independent prices even when they belong to the same product and have a known conversion.

## Locked business decisions

- The ordinary retail price is the default/base price for the exact SKU, not a constant embedded in code.
- Carton price is an independent base price for the carton SKU. It is not derived from retail price × conversion.
- Channel, customer-group, customer-specific and promotion prices are represented as price-list rules.
- Other pricing policies are created by administrators or by trusted code through the same API and stored as data.
- Application code may add a new rule type or condition, but must not contain company-specific price amounts.
- Every list and rule has explicit priority, effective dates, active state, stacking mode and optional stop-processing behavior.
- Manual order-line override has the highest precedence, requires a reason and is returned as an explicit resolution step. The order domain will later enforce permission and snapshot it.
- Historical documents must snapshot SKU, sell unit, conversion, base price, applied rule IDs and final unit price.

## Money and percentage representation

- Currency amounts are stored as integer minor units (`amount_minor`). For VND this is the đồng amount.
- Percentage adjustments use integer basis points (`rate_bps`): `100 = 1%`, `10000 = 100%`.
- Quantity uses exact fixed-scale decimal strings.
- Resolution uses integer/BigInt arithmetic with deterministic half-up rounding to the nearest minor unit.
- JavaScript floating-point arithmetic is forbidden for money and percentage calculations.

## Data model

### `shared.sales_channels`

Installation-scoped channel catalog such as retail, venue/café, wholesale, online or distributor.

### `shared.price_lists`

A list defines scope and processing policy:

- `BASE`: default SKU price; no customer/channel scope;
- `CHANNEL`: applies to one channel;
- `CUSTOMER_GROUP`: applies to one customer group and optionally a channel;
- `CUSTOMER`: applies to one customer and optionally a channel/group;
- `PROMOTION`: time-bound campaign with optional channel/group/customer scope;
- `CUSTOM`: administrator- or code-created policy using the same engine.

List controls:

- currency;
- priority;
- `EXCLUSIVE` or `STACKABLE`;
- `stop_processing`;
- effective from/to;
- active/inactive lifecycle.

### `shared.price_list_items`

Each item targets one exact product variant/SKU and defines one adjustment:

- `FIXED_PRICE`;
- `PERCENT_DISCOUNT`;
- `AMOUNT_DISCOUNT`;
- `PERCENT_MARKUP`;
- `AMOUNT_MARKUP`.

Items may also define quantity tiers, item-level effective dates, source kind (`ADMIN`, `IMPORT`, `CODE`), source key and external rule code.

## Resolution contract

Input:

```text
variantId
quantity
currencyCode (default VND)
priceAt (default now)
channelId? 
customerGroupId?
customerId?
manualUnitPriceMinor?
manualReason?
```

Resolution:

1. Validate active sellable SKU and its unit/conversion metadata.
2. Resolve customer and canonical customer group when customer ID is supplied.
3. Select the highest-priority active/effective `BASE` fixed price for the SKU and currency.
4. Match non-base lists whose non-null scopes equal the request context.
5. Sort by editable priority; list type is only a deterministic tie-breaker.
6. Apply at most one `EXCLUSIVE` candidate; apply all matching `STACKABLE` candidates in order.
7. Stop immediately when an applied list has `stop_processing = true`.
8. If a valid manual override is supplied, return it as the final price without applying automatic rules.
9. Return base price, every applied/skipped rule reason, final unit price and exact line total.

Discounts may never make the final unit price negative.

## API contract

Channels:

```text
GET    /api/sales-channels
POST   /api/sales-channels
GET    /api/sales-channels/:id
PATCH  /api/sales-channels/:id
```

Price lists:

```text
GET    /api/price-lists
POST   /api/price-lists
GET    /api/price-lists/:id
PATCH  /api/price-lists/:id
GET    /api/price-lists/:id/items
POST   /api/price-lists/:id/items
PATCH  /api/price-lists/:id/items/:itemId
```

Resolution and reviewed import:

```text
POST   /api/pricing/resolve
POST   /api/pricing/import
```

POST mutations require `Idempotency-Key`. PATCH requires `expectedUpdatedAt`. Import is atomic and source-key idempotent.

## Authorization and audit

- reads require `core.price.read`;
- mutations and import require `core.price.write`;
- every query is installation scoped;
- successful mutations write shared transactional audit records;
- no hard delete or cascade delete;
- public errors are sanitized;
- browser traffic uses same-origin server-only gateways.

## Administration UI

Canonical page: `/pricing`.

The page supports:

- create/edit/activate channels;
- create/edit/activate base, channel, customer-group, customer, promotion and custom lists;
- assign fixed prices or adjustments to exact SKUs;
- configure priority, stacking, stop-processing, quantity tiers and effective dates;
- simulate price resolution for customer/channel/SKU/quantity;
- enter a manual override and reason for preview;
- show an explainable trace of base price, applied rules and final price.

Product creation and SKU/unit management remain on `/products`. Pricing administration is separate but linked in the Core navigation.

## Source workbook boundaries

- Canonical workbook provides retail/base and carton SKU prices where present.
- Venue-channel workbook maps normalized venue prices to a dedicated channel/list.
- Ambiguous or missing SKU mappings are reported and never guessed.
- No `T` suffix generation is permitted where an explicit carton SKU exists.
- Workbook import produces normalized source keys so replay updates the same rows.
- Production data import is deferred to the grouped Phase 3 rehearsal and rollout.

## Explicit exclusions

- sales orders, quotations or invoice posting;
- inventory movements and cost calculation;
- purchasing prices and supplier contracts;
- loyalty points or coupon redemption ledger;
- product media/R2;
- production migration/import/deployment;
- `mcp/**` changes.

## Verification gate

Before merge:

- migration apply/rerun/verify/rehearsal;
- installation isolation and scope validation;
- immutable channel/list codes and item identity;
- exact VND/basis-point arithmetic and rounding;
- independent retail/carton base prices;
- priority, exclusive, stackable and stop-processing behavior;
- channel, customer group, customer, promotion and manual override resolution;
- quantity tiers and effective dates;
- source-key import replay and duplicate-race handling;
- transactional audit and idempotency;
- Core web typecheck/tests/build;
- Chromium E2E against actual PostgreSQL and Core API;
- `mcp/** = 0`.

Merge is not production deployment. Migrations `010` through `014` remain pending for the grouped Phase 3 backend/database rollout.
