# Audit 01 — Foundation, Auth và luồng Đơn hàng hiện tại

> Trạng thái: **COMPLETE / READ-ONLY AUDIT / ARCHITECTURE CORRECTED**  
> Ngày audit: **2026-07-14**  
> Mô hình đã khóa: **một NPP mỗi source clone/deployment, backend và database riêng**  
> Phạm vi: portability, auth boundary, `orders`, `order_items`, luồng tạo đơn từ MCP  
> Kết luận: **NO-GO cho full Order Core trước Foundation Slice F0 portability**

## 1. Ghi chú hiệu chỉnh kiến trúc

Bản audit ban đầu giả định hệ thống sẽ vận hành shared multi-tenant. Giả định đó đã được chủ dự án hiệu chỉnh.

Hướng chính thức:

```text
Source template gốc
-> clone cho từng NPP
-> frontend riêng
-> backend riêng
-> database riêng
-> storage/config riêng
```

Vì vậy:

- việc `orders/order_items` chưa có `tenant_id` **không phải blocker**;
- không cần TenantContext, tenant membership, tenant selector hoặc cross-tenant isolation trong phase hiện tại;
- database riêng là ranh giới tách dữ liệu giữa các NPP;
- yêu cầu đúng là code, migration và deployment phải giúp thay DB/backend instance mới dễ dàng mà không sửa business logic.

Tài liệu foundation chính thức: [`FOUNDATION_SINGLE_NPP_PORTABILITY.md`](./FOUNDATION_SINGLE_NPP_PORTABILITY.md).

## 2. Mục tiêu audit sau hiệu chỉnh

```text
1. Backend hiện phụ thuộc Supabase tới mức nào?
2. Request có actor/auth/requestId đủ cho business audit hay chưa?
3. orders/order_items có constraint và mutation boundary đủ chặt hay chưa?
4. Luồng tạo đơn từ MCP có idempotent và an toàn khi retry hay chưa?
5. Dữ liệu order production có bất thường gì cần cleanup/backfill?
6. Source hiện có đủ điều kiện dựng một DB/backend mới hay chưa?
7. Có thể code full order lifecycle ngay hay phải làm foundation portability trước?
```

Audit này không sửa code, không chạy migration, không thay dữ liệu và không deploy.

## 3. Phạm vi đã kiểm tra

### Code/runtime

- `apps/backend/server.js` và các helper gọi Supabase.
- Đường UI tạo đơn trong phiên MCP.
- Endpoint/proxy và RPC tạo đơn từ session customer.
- Success wrapper và cách normalize lỗi hiện tại.

### Database production

- Schema `orders`, `order_items`.
- Liên kết với `mcp_session_customers`, sản phẩm và biến thể.
- Constraint, index, trigger, RLS policy và table grants.
- Function `mcp_create_order_from_session_customer`.
- Thống kê aggregate chất lượng dữ liệu order.
- Auth users hiện có.

### Chưa hoàn tất trong audit này

- Chưa đối chiếu toàn bộ migrations trong repo với schema/function/policy/grant production.
- Chưa chạy dựng DB trắng.
- Chưa clone/deploy backend thứ hai.
- Chưa audit toàn bộ hardcoded URL, project ID, VPS path, domain và secret reference.
- Storage, queue và background job chưa tham gia trực tiếp vào luồng order hiện tại; audit lại khi đưa vào use case mới.

Các mục trên là portability gate tiếp theo, không được coi là đã pass.

## 4. Kết luận điều hành

Không nên bắt đầu full vòng đời đơn hàng ngay.

Blocker đúng sau hiệu chỉnh:

```text
BLOCKER 1: anon/authenticated vẫn có đường ghi trực tiếp orders/order_items.
BLOCKER 2: request tạo đơn chưa có actor/auth/requestId business context đầy đủ.
BLOCKER 3: backend order đang khóa chặt vào Supabase table/RPC trong server lớn.
BLOCKER 4: tạo đơn từ MCP chưa idempotent theo source và có thể tạo lặp.
BLOCKER 5: constraint/order lifecycle hiện quá yếu cho sửa-hủy-giao-trả-đổi.
PORTABILITY GATE: chưa chứng minh DB/backend mới dựng được hoàn toàn từ source.
```

Không còn blocker “thiếu tenant ownership”.

Thứ tự đúng:

```text
Audit hoàn tất
-> Foundation Slice F0 portability
-> clean-DB/bootstrap rehearsal
-> làm sạch order legacy
-> Order draft -> confirmed vertical slice
-> Fulfillment/Inventory
-> Receivable/Payment
-> Return/Exchange
-> clone/deploy installation thử nghiệm thứ hai
```

## 5. Kiến trúc runtime hiện tại

```text
Browser/PWA
  -> Next.js/Vercel proxy
    -> VPS Node HTTP server
      -> Supabase REST/RPC/Edge Function bằng service role
```

Backend hiện có các helper trực tiếp:

```text
supabaseGet(table, params)
supabaseInsert(table, rows)
supabasePatch(table, values)
supabaseRpc(functionName, args)
proxySupabaseFunction(functionName, body)
```

Nhận xét:

- Transport/controller, application logic và provider access còn nằm gần nhau.
- Tên bảng, RPC và lỗi provider là khái niệm trực tiếp trong backend.
- Chưa có `OrderRepository`, `TransactionManager`, `IdempotencyStore` hoặc application use case độc lập.
- Cấu trúc hiện tại chạy được cho MCP v1 nhưng không thuận lợi khi trỏ source clone sang DB/backend mới hoặc thay adapter.

Quyết định:

```text
Controller/API
-> Application use case
-> Domain rules
-> Ports
-> Supabase/PostgreSQL adapter hiện tại
```

Không cần viết nhiều provider ngay; cần tách boundary để installation mới chỉ đổi config và dùng lại adapter hiện tại.

## 6. Request/response context hiện tại

Success wrapper hiện tại:

```json
{
  "data": {},
  "receivedAt": "..."
}
```

Chưa thấy trong đường order đã audit:

```text
requestId
actorId
employeeId nếu có
permission/scope
installationId từ server config
idempotency key chuẩn
canonical business error object
```

CORS backend hiện cho phép origin cấu hình, mặc định `*`. Danh sách header trong đoạn code audit chỉ gồm `Content-Type, Accept`; chưa thấy `Authorization` hoặc idempotency header được xử lý rõ ở đường order.

Kết luận:

- Service role xác thực hạ tầng, không xác định actor nghiệp vụ.
- `created_by`/`updated_by` trong `orders` nullable và RPC hiện chưa cung cấp actor đầy đủ.
- Mutation mới cần `InstallationContext` + actor + requestId, nhưng không cần tenant context.

## 7. Auth và phân quyền hiện tại

Kết quả:

- Có `auth.users`; tại thời điểm audit có **3** tài khoản.
- Chưa tìm thấy public model rõ ràng cho role, permission, scope assignment và employee-user linking trong phạm vi đã kiểm tra.

Đây là vấn đề auth/permission nội bộ một NPP, không phải multi-tenant.

Cần tối thiểu:

```text
identity/user
employee
role
permission
role assignment
branch/warehouse/territory scope
policy/threshold
actor/audit context
```

Không cần tạo:

```text
tenants
tenant_memberships
tenant selector
platform admin cross-NPP
```

## 8. Schema `orders`

Field hiện có:

```text
id, order_code
customer_id
route_id, session_id
status
payment_method, note
subtotal, discount_total, grand_total
source_type, source_id
sync_status
created_at, updated_at
created_by, updated_by
```

Thiếu cho Order Core:

```text
version hoặc optimistic lock
idempotency_key
order lifecycle constraint
fulfillment_status riêng
payment_status riêng
currency/rounding contract
atomic business document sequence
actor bắt buộc cho mutation quan trọng
```

Không bắt buộc `tenant_id` vì database chỉ phục vụ một NPP.

`status` hiện là text mặc định `draft`, chưa có check constraint giới hạn trạng thái hợp lệ.

## 9. Schema `order_items`

Field chính:

```text
id
order_id
product_id, variant_id
product_name, sku, unit
quantity
unit_price, discount, line_total
note, created_at
```

Constraint hiện có:

- Primary key.
- FK `order_id -> orders(id)` với `ON DELETE CASCADE`.

Thiếu:

```text
quantity > 0 check
product_id/variant_id FK đáng tin cậy
unit snapshot/conversion contract
created_by/updated_by
version/audit event
ordered/cancelled/allocated/shipped/delivered/returned quantities
```

`ON DELETE CASCADE` chỉ phù hợp cho draft/legacy đơn giản; không được xóa lịch sử order đã ảnh hưởng kho/công nợ.

## 10. Constraint và index audit

Đã xác nhận:

- `orders` chỉ có primary key trong nhóm constraint audit.
- `order_items` có primary key và FK về `orders`.
- Không có unique constraint cho `order_code`.
- Không có unique constraint cho source reference.
- Không có check `quantity > 0`.
- Không có check order status.
- Không tìm thấy trigger active trên `orders`/`order_items` trong truy vấn audit.

Hệ quả:

- Duplicate source/order code không bị DB chặn.
- Dòng quantity 0 có thể tồn tại.
- Tính tiền/invariant phụ thuộc từng mutation path.
- Không thể an toàn mở rộng lifecycle phức tạp trước cleanup + constraint.

## 11. Security boundary của `orders` và `order_items`

RLS đang bật nhưng chưa tạo boundary an toàn.

Policy ghi nhận:

```text
orders:
- anon SELECT
- anon INSERT WITH CHECK true
- anon UPDATE USING true / WITH CHECK true

order_items:
- anon SELECT
- anon INSERT WITH CHECK true
- anon UPDATE USING true / WITH CHECK true
```

Table grants của `anon` và `authenticated` còn gồm nhiều quyền trên `orders`/`order_items`, trong đó có `INSERT`, `UPDATE`, `DELETE` và `TRUNCATE`.

Với policy `INSERT/UPDATE ... true`, client anon còn đường ghi trực tiếp hợp lệ.

Đây là blocker vì:

- VPS backend chưa phải mutation boundary duy nhất.
- Client có thể bypass transition, idempotency, actor/permission và audit.
- Source clone mới sẽ mang theo lỗ hổng này nếu không sửa bằng migration.

Không revoke nóng trước khi audit toàn bộ consumer. Phải:

```text
consumer audit
-> chuyển mutation hợp lệ về backend
-> smoke tests
-> migration revoke/gỡ policy write=true
-> verify read contract
-> forward-fix plan
```

## 12. Luồng tạo đơn từ MCP

UI tạo đơn qua:

```text
POST /api/mcp-orders/from-session-customer
```

Payload hiện có:

```text
sessionCustomerId
items
note
status = confirmed
```

Chưa có:

```text
actor context
idempotency key
expected version
requestId chuẩn
```

RPC `mcp_create_order_from_session_customer` có điểm tốt:

- transaction DB;
- lock session customer;
- chặn phiên đóng;
- tạo order/items thật;
- gắn order với session customer/visit;
- cập nhật counter;
- quyền execute RPC giới hạn cho `service_role`.

Vấn đề:

### 12.1 Không idempotent theo source

Không có unique/check theo:

```text
(source_type, source_id, operation)
```

Retry có thể tạo order mới.

### 12.2 Có thể ghi đè liên kết order

RPC cập nhật `mcp_session_customers.order_id` bằng order mới. Gọi lại có thể thay liên kết trong khi order cũ còn tồn tại.

### 12.3 Chấp nhận quantity bằng 0

Quantity được chuẩn hóa không âm nhưng vẫn có thể bằng 0.

### 12.4 Mã đơn theo timestamp nhưng không unique atomic

Dữ liệu đã xuất hiện nhóm order code trùng.

### 12.5 Tạo thẳng `confirmed`

Đây là contract MCP v1 hiện hành. Order Core mới phải tiếp nhận MCP như một source adapter, không mở rộng endpoint MCP thành toàn bộ order lifecycle.

## 13. Chất lượng dữ liệu order tại thời điểm audit

| Chỉ số | Kết quả |
|---|---:|
| Orders | 18 |
| Order items | 12 |
| Orphan item | 0 |
| Item thiếu order_id | 0 |
| Order không có item | 7 |
| Order thiếu customer_id | 0 |
| Order thiếu source_type | 5 |
| Order thiếu source_id | 5 |
| Order thiếu status | 0 |
| Header total lệch tổng item | 0 |

Status:

| Status | Số lượng |
|---|---:|
| confirmed | 10 |
| draft | 7 |
| created | 1 |

`created` là trạng thái legacy ngoài contract dự kiến.

Source:

| Source type | Số lượng |
|---|---:|
| mcp_session_customer | 13 |
| null | 5 |

Bất thường:

| Vấn đề | Kết quả |
|---|---:|
| Nhóm duplicate source reference | 1 |
| Nhóm duplicate order_code | 1 |
| Dòng quantity <= 0 | 3 |
| Dòng thiếu product_id | 4 |
| Dòng thiếu variant_id | 4 |
| Dòng thiếu SKU | 4 |
| Dòng thiếu unit | 2 |
| Giá âm | 0 |
| Discount âm | 0 |

Không được thêm constraint trực tiếp trước khi phân loại/backfill row legacy. Không tự xóa duplicate hoặc suy đoán fulfillment/payment.

## 14. Portability gap cần audit tiếp

Chưa đủ bằng chứng để khẳng định source hiện tại có thể dựng NPP mới chỉ bằng config.

Cần kiểm tra:

```text
1. Tất cả migrations có tái tạo đủ tables/indexes/functions/triggers/RLS/grants không?
2. Có schema/function chỉ tồn tại trên production không?
3. Có URL, Supabase project ID, VPS IP/path, domain hardcode trong source không?
4. Có `.env.example` đầy đủ không?
5. Seed/bootstrap NPP mới đã tồn tại và idempotent chưa?
6. Backend mới có build/start/health/deploy contract rõ chưa?
7. DB trắng có chạy full MCP smoke được không?
8. Frontend có chỉ cần đổi API URL/config không?
```

Đây là việc đầu tiên của Foundation Slice F0, không được bỏ qua.

## 15. Risk register

| Mức | Rủi ro | Tác động | Điều kiện gỡ |
|---|---|---|---|
| BLOCKER | Anon/auth ghi trực tiếp order | Bypass backend/domain/audit | Consumer audit + migration khóa write |
| BLOCKER | Thiếu actor/auth/request context | Không biết ai làm gì | InstallationContext + auth/permission middleware |
| BLOCKER | Tạo order MCP không idempotent | Duplicate order, ghi đè link | Source/idempotency contract + retry tests |
| BLOCKER | Constraint/order lifecycle yếu | Dữ liệu xấu và sai transition | Cleanup + checks/unique/version/events |
| HIGH | Backend khóa chặt provider | Khó thay DB/backend instance/adapter | Use cases + ports/adapters |
| HIGH | Một order status gánh nhiều nghĩa | Sai giao hàng/thanh toán | Tách ba trục status |
| HIGH | Mã order không sequence atomic | Trùng số concurrent | Atomic document sequence |
| HIGH | Legacy data không đồng nhất | Migration thất bại | Mapping/review/reconciliation |
| HIGH | Chưa chứng minh clean-DB bootstrap | Clone NPP mới có thể thiếu schema | Migration inventory + rehearsal |
| MEDIUM | Response chưa requestId/error object | Khó trace/đổi provider | Canonical API envelope |
| MEDIUM | Config/hardcode chưa audit | Clone có thể trỏ nhầm production cũ | Config inventory + clone scan |

## 16. Foundation Slice F0 đúng

### F0.1 — Audit portability/config

```text
URL/domain/IP/path/project ID hardcode
required environment variables
secret boundaries
build/start/deploy/health commands
production DB vs migration inventory
```

### F0.2 — InstallationContext + auth

```text
installationId từ server config
distributorCode
actorId
employeeId
permission/scope
requestId
```

### F0.3 — Application/use case và ports

```text
CreateOrderDraft
ConfirmOrder
OrderRepository
TransactionManager
IdempotencyStore
AuditEventStore
Clock
IdGenerator
```

Supabase/PostgreSQL chỉ nằm trong adapter.

### F0.4 — Canonical API envelope

Giữ success/error DTO trung tính và thêm requestId.

### F0.5 — Consumer audit rồi khóa direct DB mutation

Không revoke trước khi biết mọi consumer; sau đó migration khóa anon/auth write.

### F0.6 — Migration/bootstrap contract

```text
production schema inventory
missing migrations/functions/policies/grants
clean DB migration
idempotent bootstrap/seed
full MCP smoke
```

### F0.7 — Làm sạch order legacy

```text
7 order không có item
status created
5 order thiếu source
source/order code duplicate
3 dòng quantity <= 0
các dòng thiếu product/variant/SKU/unit
```

### F0.8 — Constraint/idempotency

```text
unique order number
unique source/idempotency contract
quantity > 0
status checks
optimistic version
audit event
```

### F0.9 — Order vertical slice đầu tiên

```text
create draft
-> update draft
-> confirm
-> cancel before fulfillment
```

### F0.10 — Clone rehearsal

```text
clone source
-> DB mới
-> backend mới
-> env/secrets mới
-> migrations/bootstrap
-> frontend config mới
-> MCP/order smoke
```

## 17. Gate trước Order Core

```text
[ ] InstallationContext + actor/requestId hoạt động
[ ] Permission/scope được backend enforce
[ ] Application/repository boundary có test
[ ] Public API không lộ provider/schema
[ ] Anon/auth không còn mutation trực tiếp orders/order_items
[ ] Legacy anomalies có mapping/backfill plan
[ ] Idempotency contract đã khóa
[ ] Production DB đã đối chiếu với migrations/functions/policies/grants
[ ] DB trắng chạy migrations/bootstrap thành công
[ ] Full MCP smoke pass trên DB trắng
[ ] Không còn hardcode installation gốc trong source clone
[ ] Migration/forward-fix plan được duyệt
```

## 18. Checklist audit

```text
[x] Audit provider coupling trên đường Order/MCP
[x] Audit auth/user/RLS/permission liên quan order
[x] Audit orders/order_items/API/UI/production aggregates
[x] Audit RPC tạo order từ MCP
[x] Audit constraint/index/RLS/table grant
[x] Audit dữ liệu legacy bằng aggregate, không đọc PII
[x] Hiệu chỉnh bỏ giả định shared multi-tenant
[x] Xác định blocker và remediation order

[ ] Audit hardcoded config/URL/project ID/path
[ ] Đối chiếu production DB với migrations/functions/policies/grants
[ ] Chạy clean-DB migration rehearsal
[ ] Viết bootstrap/seed
[ ] Implement InstallationContext
[ ] Chuẩn hóa API envelope
[ ] Tách ports/adapters
[ ] Làm sạch order legacy
[ ] Sửa code order
[ ] Clone/deploy installation test thứ hai
```

## 19. Kết luận cuối

```text
Audit Bước 1 đã hoàn thành và đã hiệu chỉnh đúng mô hình kinh doanh.

MCP v1 core vẫn frozen.
DB/backend hiện tại tiếp tục là môi trường phát triển và test thật.
Mỗi NPP bán mới sẽ có source clone + backend + DB riêng.
Thiếu tenant_id không phải blocker.

Việc tiếp theo đúng logic là Foundation Slice F0 portability:
config -> InstallationContext -> ports/adapters -> migrations/bootstrap
-> cleanup/idempotency -> clean DB rehearsal.

Không làm thêm UI đơn hàng hoặc full lifecycle trước khi foundation này pass.
```