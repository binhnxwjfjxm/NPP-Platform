# DB Audit - MCP-Plan

Ngay audit: 2026-07-03
Supabase project: `noiadkpkvdohljgopgfb`
Postgres: 17

## 1. Ket luan nhanh

DB khong chi la report. Hien da co du lieu cot loi cho MCP route, customer, visit, test va order.

`market_reports` dang co schema nhung chua co dong du lieu, nen khong duoc lay market report lam module phase 1. Phase 1 phai dua tren cac bang dang co data:

- Route planning
- Route customer list
- Visit tracking
- Product/customer test
- Order summary

## 2. Bang public hien co va vai tro

| Table | Vai tro | Uoc tinh dong |
|---|---|---:|
| `mcp_routes` | Danh muc tuyen ban hang | 8 |
| `mcp_route_customers` | Khach hang theo tuyen | 51 |
| `mcp_route_sessions` | Phien di tuyen theo ngay | 7 |
| `mcp_visits` | Luot ghe tham trong phien tuyen | 73 |
| `orders` | Don hang | 2 |
| `order_items` | Dong san pham trong don | 3 |
| `test_files` | Dot test/kiem tra | 8 |
| `test_customers` | Khach hang trong dot test | 65 |
| `test_file_products` | San pham test | 33 |
| `test_customer_results` | Ket qua test theo khach hang/san pham | 299 |
| `market_reports` | Bao cao thi truong | 0 |

## 3. Luong nghiep vu thuc te tu DB

### 3.1 Route

- `mcp_routes` la master route.
- `mcp_route_customers.route_id` gan khach hang vao route.
- `mcp_route_sessions.route_id + session_date` tao phien di tuyen.
- `mcp_visits.session_id` ghi nhan tung luot ghe khach.

Luot route hien co:

- 8 route active.
- 51 route customers active.
- 7 route sessions.
- 73 visits.

### 3.2 Test/kiem tra thi truong

- `test_files` la dot test.
- `test_file_products` la san pham can test trong file.
- `test_customers` la khach hang cua file.
- `test_customer_results` la ket qua theo tung customer/product.

Du lieu hien co:

- 8 test files active.
- 65 test customers.
- 33 test products.
- 299 test results.

### 3.3 Order

- `orders` la header don.
- `order_items` la chi tiet SKU/san pham.
- Du lieu order hien con it: 2 orders, 3 order items, tong `grand_total` = 403000.

### 3.4 Market report

- `market_reports` da co cot phan tich: competitor, price, demand, opportunity, risk, next_action.
- Hien 0 dong, nen chua phai nguon chinh cho phase 1.

## 4. Date range hien co

| Entity | Min date | Max date |
|---|---|---|
| `orders` | 2026-06-29 | 2026-06-29 |
| `mcp_route_sessions` | 2026-06-29 | 2026-07-02 |
| `mcp_visits` | 2026-06-29 | 2026-06-30 |
| `test_files` | 2026-06-28 | 2026-07-01 |

## 5. Quan he va thieu sot constraint

Da co FK cho nhom test:

- `test_customers.file_id -> test_files.id`
- `test_file_products.file_id -> test_files.id`
- `test_customer_results.file_id -> test_files.id`
- `test_customer_results.customer_id -> test_customers.id`

Chua thay FK ro rang cho nhom MCP route/order:

- `mcp_route_customers.route_id` chua co FK enforced toi `mcp_routes.id`.
- `mcp_route_sessions.route_id` chua co FK enforced toi `mcp_routes.id`.
- `mcp_visits.session_id` chua co FK enforced toi `mcp_route_sessions.id`.
- `mcp_visits.route_customer_id` chua co FK enforced toi `mcp_route_customers.id`.
- `order_items.order_id` chua co FK enforced toi `orders.id`.

Khong duoc them FK ngay lap tuc neu chua kiem tra orphan data. Phai check orphan truoc roi moi migration.

## 6. Security/RLS

Tat ca bang public hien co deu bat RLS va moi bang co 3 policies. Tuy nhien advisor canh bao nhieu policy `anon insert/update` dang qua mo voi dieu kien `true`.

Can dua vao phase security hardening:

- Rut quyen ghi truc tiep cua `anon`.
- Chi cho ghi qua backend/service role hoac authenticated role co dieu kien.
- Xem lai function `public.rls_auto_enable()` vi dang la SECURITY DEFINER va public co the execute.
- Function `public.set_updated_at` can set search_path co dinh.

## 7. Performance

Index hien co:

- `mcp_route_customers(route_id)`
- `mcp_route_sessions(route_id, session_date)`
- `mcp_visits(session_id)`
- `mcp_visits(route_customer_id)`
- `orders(order_date)`
- `order_items(order_id)`
- `test_files(status, deleted_at)`
- `test_file_products(file_id)`
- `test_customers(file_id)`
- `test_customer_results(file_id, customer_id)`
- `market_reports(report_date)`

Advisor bao thieu covering index cho FK:

- `test_customer_results.customer_id`

Can them index sau khi chot query pattern:

```sql
create index if not exists idx_test_customer_results_customer_id
on public.test_customer_results(customer_id);
```

## 8. Nguyen tac tiep theo

- Phase 1 chi doc DB hien co, khong sua bang goc.
- Backend gom query logic va tinh KPI.
- Neu can ghi plan/action thi tao bang rieng `mcp_plans`, `mcp_plan_items`, `mcp_action_logs`.
- Moi migration phai co ly do, query kiem tra truoc/sau va rollback note.
