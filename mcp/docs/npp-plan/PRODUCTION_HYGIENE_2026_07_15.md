# Production Hygiene — 2026-07-15

> Trạng thái: **DATA CLEANED / SOURCE AND MIGRATION IN REVIEW**

## 1. Incident

The MCP v1 API smoke created real production business rows. Route hard-delete removed the MCP route/session graph but did not remove business rows created in `orders`, `market_reports` and the test tables. Those orphaned fixtures appeared in the production Orders UI with dates in 2099 and labels such as `API Smoke`.

The Chrome console warning about `apple-mobile-web-app-capable` was unrelated to the data incident, but is fixed in the same hygiene slice by adding the standard `mobile-web-app-capable` metadata declaration.

## 2. Production cleanup evidence

A dry-run locked exact IDs and verified that no `mcp_session_customers` or `mcp_visits` referenced the target order/test/report IDs.

One atomic PostgreSQL statement deleted exactly:

```text
orders                 4
order_items            4
market_reports         4
test_files             4
test_file_products     4
test_customers         4
test_customer_results  4
TOTAL                  28
```

Post-cleanup verification:

```text
orders_2099_smoke      0
reports_2099_smoke     0
test_files_2099_smoke  0
smoke_order_items      0
smoke_test_customers   0
smoke_test_results     0
real_report_preserved  true
```

The real report `report_c0096ae018e4483092602880b28ae048` for Cô Loan / Bến Tre was explicitly excluded and verified present after cleanup.

## 3. Exact deleted IDs

### Orders

```text
order_ba1949f7a8aa4f4fa8d7b826a982d714
order_0b775e6b314f48148a413df1365c250c
order_041e8a1544dc41a99a068760153ccba2
order_3afe87b4a08a4f6ba0805b7f357b4adf
```

### Order items

```text
order_item_cdb7fd4d574342d98f9ef63c9ccf6eb7
order_item_25cb8c6117ef45eaa81b824d62473cfd
order_item_2f4b7112ddc44c0ea41b91876e43e027
order_item_e9dce5c65e9a47099b188cb734e8cceb
```

### Market reports

```text
report_b0b4833876ac4355b495e6d6ce32598f
report_f5773f8dd88f4edf96bbc1c3e0531472
report_b9a0f02e319b4ce6ba037a7f6170eeaf
report_4e851aae4aa847129912b0f0797e87c4
```

### Test files

```text
test_file_b70d18490288409fa05def099c716a9b
test_file_01934f7403534c1685efa15579d28f2f
test_file_4d20be2afe2441c6a72d557896ef2a7c
test_file_d8eada53a66e40b4849d0508c57b3399
```

The related four `test_file_products`, four `test_customers`, and four `test_customer_results` were deleted by their exact IDs in the same statement.

## 4. Root cause repair

The repair does not hide test text in the frontend.

```text
scripts/smoke-mcp-v1-api.mjs
  -> tracks every smoke route
  -> always enters cleanup after the smoke body
  -> fails the smoke if guarded cleanup is not confirmed

mcp_delete_route_hard
  -> normal routes keep existing hard-delete behavior
  -> business-table cleanup runs only when all strict smoke guards match:
     route_name regex + area + note + 2099 date + API Smoke owner + route/session linkage
  -> service_role only

CI
  -> scans production runtime and production seed for smoke markers
  -> verifies guarded migration, mandatory cleanup and PWA metadata
```

## 5. Deployment gates

```text
[ ] Foundation CI pass
[ ] Migration source contract pass
[ ] Migration applied to production
[ ] VPS pullmcp pass
[ ] MCP v1 API smoke pass with guarded cleanup counts
[ ] Post-smoke production query returns zero smoke fixtures
[ ] Vercel production serves mobile-web-app-capable metadata
[ ] Runtime logs contain no new 500/401 cluster
```

A5.4.2 remains paused until every hygiene gate is verified.
