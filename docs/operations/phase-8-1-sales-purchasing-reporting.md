# Phase 8.1 — Sales + Purchasing Reporting

Parent: #367  
Issue: #370

Baseline: `main@edac86e9c6aa8e75267ff11219f04f240395e8b4`

This slice implements only the first operational reporting family after the Phase 8.0 source gate. It includes one forward-only metadata migration (`064_reporting_permission_catalog`) so the two new reporting permissions exist in the canonical database permission catalog. It does not add reporting tables/read models and does not authorize production deploy or production migration.

## User outcome

NPP Operations gets two detailed report entry points inside the existing business groups:

- `/sales/reporting` inside **Bán hàng**;
- `/purchasing/reporting` inside **Mua hàng**.

A navigation item is valid only when the matching page and rendered workspace exist in the same source change. Reporting actions drill back to existing operational routes; no global Reporting menu or orphan route is introduced.

## Sales metric contract

| Item | Locked definition |
| --- | --- |
| Business meaning | Current effective Sales Order volume/value and operational lifecycle in the selected confirmation period |
| Canonical source | `sales.sales_orders` plus latest immutable `sales.sales_order_versions` whose `version_status` is `confirmed` or `superseded`; line ranking uses the matching `sales.sales_order_version_lines` |
| Inclusion/exclusion | Value metrics include order status `confirmed` and `closed`; `cancelled` is counted separately and excluded from value; drafts have no `confirmed_at` and are outside the report |
| Business date | `sales.sales_orders.confirmed_at`, bounded and grouped in `Asia/Ho_Chi_Minh` |
| Dimensions | currency, order status, fulfillment status, delivery status, settlement status, customer, SKU/base variant, business date |
| Money/quantity | Monetary sums remain PostgreSQL `numeric` and are returned as decimal strings, partitioned by `currency_code`; SKU quantity sums only `base_quantity` within the same variant |
| Scope | server-owned installation plus authorized warehouse scope; optional requested warehouse must already be authorized |
| Mode | live query, `Cache-Control: no-store` |
| Drill-down | customer rows -> `/sales/sales-orders?search=<customer-code>`; SKU rows -> a canonical sample order number on `/sales/sales-orders`; page action opens `/sales/sales-orders` |
| Ranking identity | Top customers group by stable `customer_id`; top SKU groups by stable `variant_id`; latest snapshots are display labels only, so a rename inside the period cannot split one entity into multiple ranking rows |
| Reconciliation assertion | currency totals equal the sum of effective Sales Order version totals under the exact filter/scope; no draft amendment can replace the latest confirmed/superseded commercial version |

## Purchasing metric contract

| Item | Locked definition |
| --- | --- |
| Business meaning | Current effective Purchase Order volume/value plus receipt lifecycle in the selected period |
| Canonical source | `purchasing.purchase_orders`, `purchasing.purchase_order_lines`, `purchasing.goods_receipts` |
| Inclusion/exclusion | Value metrics include `approved`, `partially_received`, `fully_received`, `closed`; `draft`, `pending_approval`, `cancelled` do not enter effective value; receipt counts keep `posted` and `reversed` separate |
| Business date | Purchase Order metrics use canonical `order_date`; receipt lifecycle uses canonical `receipt_date` |
| Dimensions | currency, PO status, receipt status, supplier, SKU/base variant, business date |
| Money/quantity | PO money remains PostgreSQL `numeric` as decimal strings partitioned by currency; SKU quantity sums only variant `base_quantity`; there is no cross-SKU/cross-unit receipt quantity total |
| Scope | server-owned installation plus authorized warehouse scope; optional requested warehouse must already be authorized |
| Mode | live query, `Cache-Control: no-store` |
| Drill-down | supplier rows -> `/purchasing/purchase-orders?search=<supplier-code>`; SKU rows -> a canonical sample PO number; page actions open existing Purchase Order and Goods Receipt routes |
| Ranking identity | Top suppliers use stable `supplier_id`; top SKU groups by stable `variant_id`; changing SKU/name snapshots inside the period cannot split one item into multiple ranking rows |
| Reconciliation assertion | currency totals equal effective PO totals under the exact filter/scope; posted/reversed receipt counts reconcile to `goods_receipts` under the receipt-date filter |

## Permission contract

Backend endpoints:

- `GET /api/reporting/sales` requires `core.reporting.sales.read`;
- `GET /api/reporting/purchasing` requires `core.reporting.purchasing.read`.

Both deny by default. Reporting permissions are registered in the runtime permission catalog and in the database catalog through forward-only migration `064_reporting_permission_catalog`. Migration 064 only upserts canonical permission metadata; it does not assign either permission to any end-user role.

The internal NPP bootstrap service principal receives only these two Phase 8.1 reporting permissions so the existing server-side gateway can call Core. End-user access remains a separate role/scope concern.

## UI and route contract

- Sales reporting stays in the existing Sales group.
- Purchasing reporting stays in the existing Purchasing group.
- No navigation item is added without a real `page.tsx`.
- No page-level action points to a route that does not already exist.
- Browser code never receives the Core server token.
- Browser pages call same-origin `/api/reporting/...`; the server-only gateway calls Core.
- No CSV/export button is added in 8.1 because official export requires the separate `core.reporting.export` contract.
- Existing `/dashboard` remains the organization overview and is not repurposed into Phase 8 reporting.

## Period defaults and bounds

When `from`/`to` are omitted, Core owns the default period:

- `from`: first calendar day of the current month in `Asia/Ho_Chi_Minh`;
- `to`: current business date in `Asia/Ho_Chi_Minh`.

Timestamp-backed Sales filtering uses local midnight inclusive through the next local midnight exclusive. Purchase/receipt `date` columns compare calendar dates directly.

A requested period is inclusive and may span at most **366 calendar days**. Longer requests fail before aggregate queries run so one read-only request cannot fan out over unbounded reporting history.

## Error and scope hardening

- warehouse UUID input is normalized before comparison with server-owned scope;
- bootstrap warehouse expansion is caught and returns a sanitized reporting scope error if the database lookup fails;
- raw PostgreSQL/SQLSTATE error codes are never returned to clients;
- unknown query failures return the reporting API error contract and are logged server-side only with bounded diagnostic metadata.

## Migration and production boundary

Source includes migration `064_reporting_permission_catalog` because migration verification requires the database permission catalog to match the runtime permission registry. It is metadata-only and rerunnable through `ON CONFLICT (permission_key) DO UPDATE`.

Source merge does **not** authorize applying 064 on production. Any later production DB mutation remains a separate gate and must follow the repository sequence:

`audit pending -> backup -> restore rehearsal -> pre-reconciliation -> migration -> verify/rerun -> post-reconciliation -> smoke`

This slice does not:

- deploy Vercel or Heroku;
- run migration 064 on production;
- change the production database manually;
- start Phase 8.2.
