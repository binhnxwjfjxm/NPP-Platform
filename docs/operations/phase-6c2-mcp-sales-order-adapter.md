# Phase 6C.2 — MCP official Sales Order adapter

> Status: **SOURCE IMPLEMENTATION — NO PRODUCTION DEPLOYMENT OR MIGRATION**  
> Issue: `#186`  
> Branch: `agent/phase-6c2-mcp-sales-order-adapter`  
> Baseline: `main@a5d83e6dab410f431b7f5b9da281ae536b7605b2`

## User flow

```text
MCP employee records a purchase demand
-> customer onboarding is approved or linked_existing
-> employee explicitly opens “Đơn NPP”
-> employee taps “Tạo đơn nháp NPP”
-> MCP backend calls canonical Core Sales Order API
-> Core validates customer/address/warehouse/SKU/unit and calculates price/tax
-> MCP stores and displays the Core Sales Order reference and status
```

Opening the screen, recording a demand or synchronizing customer status does not create a Sales Order.

## Product source

The existing MCP product endpoints are retained for UI compatibility, but the MCP backend now serves them from Core:

```text
GET /api/products/search
GET /api/products/:productId/variants
              -> Core GET /api/sales-orders/sku-search
```

Legacy MCP product/SKU/price rows are not authoritative for official orders. Core revalidates each variant and determines unit, price, discount and tax when creating the draft.

## Sales boundary

MCP calls Core with a dedicated server principal that has only:

```text
core.sales-order.read
core.sales-order.create
```

It also has an explicit warehouse scope. It cannot confirm, amend, cancel or override commercial values.

Canonical source identity:

```text
sourceType     = MCP
sourceId       = MCP order ID
sourceOutletId = stable MCP route/session outlet reference
```

The deterministic command key is:

```text
mcp-sales-order-<MCP order ID>
```

Same demand and payload reuses/synchronizes the existing order. A changed payload on the same demand conflicts before another create call.

## MCP projection

Migration `mcp_007_core_sales_order_sync` adds structured fields to `mcp.orders` for:

- Core Sales Order ID and number;
- order status and current version;
- Core total/currency read projection;
- submission fingerprint;
- submitted and last-synchronized timestamps.

MCP does not own the Core Sales Order lifecycle.

## PWA icon

The shell logo remains unchanged. The manifest now uses square 192px and 512px icons rendered from the existing NPP logo asset, including a maskable icon. No new artwork is generated.

## Non-scope

- automatic Sales Order creation;
- Core order confirmation/amendment/cancellation;
- inventory reservation or issue;
- Delivery Order, dispatch, receivable, payment or COD;
- production deploy or production migration;
- provider, database attachment or auto-deploy changes.
