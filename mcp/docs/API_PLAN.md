# API Plan - MCP-Plan

## Nguyen tac API

- Backend la noi gom query va logic nghiep vu.
- Frontend khong query Supabase truc tiep cho dashboard phuc tap.
- API phai co filter ro: date range, route_id, sales, area, status.
- API phai tra ve data da chuan hoa, khong de UI phai doan nghia cot.
- Read API lam truoc. Write API lam sau khi chot RLS/auth.

## 1. Dashboard

### `GET /api/dashboard/summary`

Muc dich: card KPI tong quan.

Nguon DB:

- `mcp_routes`
- `mcp_route_customers`
- `mcp_route_sessions`
- `mcp_visits`
- `test_files`
- `test_customers`
- `test_customer_results`
- `orders`
- `order_items`

Query params:

- `from`: date optional
- `to`: date optional
- `sales`: text optional
- `area`: text optional

Output de xuat:

```json
{
  "routes": { "active": 8 },
  "customers": { "active": 51 },
  "sessions": { "total": 7, "active": 4 },
  "visits": { "total": 73, "visited": 72, "with_order": 0 },
  "tests": { "files": 8, "customers": 65, "products": 33, "results": 299 },
  "orders": { "count": 2, "value": 403000 }
}
```

## 2. Routes

### `GET /api/routes`

Nguon DB: `mcp_routes`

Fields:

- `id`
- `route_name`
- `weekday`
- `area`
- `distributor_id`
- `active`
- `note`

Can join/aggregate:

- customer count tu `mcp_route_customers`
- session count tu `mcp_route_sessions`
- visit count tu `mcp_visits`

### `GET /api/routes/:routeId/customers`

Nguon DB: `mcp_route_customers`

Fields:

- `id`
- `route_id`
- `customer_id`
- `customer_name`
- `phone`
- `area`
- `address`
- `sort_order`
- `geo_lat`
- `geo_lng`
- `google_maps_url`
- `active`

## 3. Route sessions / visits

### `GET /api/route-sessions`

Nguon DB: `mcp_route_sessions`

Filter:

- `from`
- `to`
- `route_id`
- `sales`
- `status`

Fields:

- `id`
- `route_id`
- `route_name`
- `session_date`
- `weekday`
- `sales`
- `area`
- `status`
- `planned_customers`
- `visited_customers`
- `order_count`
- `test_count`
- `report_count`

### `GET /api/visits`

Nguon DB: `mcp_visits`

Filter:

- `from`
- `to`
- `session_id`
- `route_id`
- `status`
- `has_order`
- `has_test`
- `has_report`

Fields:

- `id`
- `session_id`
- `route_id`
- `route_customer_id`
- `visit_date`
- `status`
- `has_order`
- `has_test`
- `has_report`
- `order_id`
- `test_id`
- `report_id`
- `checkin_at`
- `note`

## 4. Test module

### `GET /api/tests/files`

Nguon DB: `test_files`

Filter:

- `from`
- `to`
- `sales`
- `status`

Fields:

- `id`
- `title`
- `test_date`
- `sales`
- `status`
- `note`
- `created_at`

Aggregate:

- product count tu `test_file_products`
- customer count tu `test_customers`
- result count tu `test_customer_results`

### `GET /api/tests/files/:fileId/results`

Nguon DB:

- `test_customer_results`
- join `test_customers`
- optional join `test_file_products` bang product name/product id neu can

Filter:

- `status`
- `customer_id`
- `product_name`

Fields:

- `id`
- `file_id`
- `customer_id`
- `customer_name`
- `product_id`
- `product_name`
- `status`
- `note`

## 5. Orders

### `GET /api/orders`

Nguon DB: `orders`

Filter:

- `from`
- `to`
- `sales`
- `customer_id`
- `status`
- `area`

Fields:

- `id`
- `order_code`
- `order_date`
- `sales`
- `customer_id`
- `customer_name`
- `customer_phone`
- `area`
- `source_type`
- `source_id`
- `status`
- `subtotal`
- `discount_total`
- `grand_total`

### `GET /api/orders/:orderId/items`

Nguon DB: `order_items`

Fields:

- `id`
- `order_id`
- `product_id`
- `product_name`
- `sku`
- `unit`
- `quantity`
- `unit_price`
- `discount`
- `line_total`

## 6. MCP-Plan write API sau nay

Chi lam sau khi co bang MCP-Plan rieng.

- `POST /api/plans`
- `GET /api/plans`
- `GET /api/plans/:id`
- `POST /api/plans/:id/items`
- `PATCH /api/plan-items/:id/status`
- `POST /api/action-logs`

Khong ghi plan/action vao `orders`, `mcp_visits`, `test_customer_results` neu khong lien quan truc tiep.
