# Foundation — Một NPP mỗi deployment và khả năng thay DB/backend

> Trạng thái: **FOUNDATION / REQUIRED BEFORE NEW CORE MUTATIONS**  
> Ngày khóa hướng kiến trúc: **2026-07-14**  
> Mô hình bán hàng: **clone source gốc cho từng NPP; mỗi NPP có frontend, backend, database và cấu hình riêng**  
> Mục tiêu: dựng một NPP mới bằng cấu hình + migration + seed + deploy, không sửa lại logic nghiệp vụ

## 1. Quyết định kiến trúc đã khóa

Mỗi NPP là một installation độc lập:

```text
Source template gốc
├── Frontend
├── Backend
├── Domain/Application
├── Infrastructure adapters
├── Database migrations
├── Seed/bootstrap
└── Smoke/contract tests

NPP A
source clone A -> frontend A -> backend A -> database A -> storage A

NPP B
source clone B -> frontend B -> backend B -> database B -> storage B
```

Hệ thống hiện tại phải có DB/backend thật để phát triển và kiểm thử. Khi bán cho NPP mới, không đưa NPP mới vào chung DB/backend hiện tại; tạo một installation mới từ source gốc.

Các quyết định bắt buộc:

1. **Một deployment chỉ phục vụ một NPP.**
2. **Không xây shared SaaS/multi-tenant trong phase hiện tại.**
3. **Không bắt buộc `tenant_id` trên mọi bảng.** Database riêng là ranh giới tách dữ liệu.
4. **Không cần tenant selector, tenant membership hoặc platform admin cross-tenant.**
5. Code phải thay được DB/backend instance bằng cấu hình, migration và adapter; không sửa domain hoặc frontend contract.
6. Ưu tiên portability giữa các installation dùng cùng stack hiện tại trước. Khả năng đổi provider khác được bảo vệ bằng ports/adapters nhưng không over-engineer nhiều DB engine ngay.

## 2. Ý nghĩa của “dễ thay DB/backend”

Yêu cầu cấp 1 — bắt buộc ngay:

```text
Clone source
-> tạo Supabase/PostgreSQL project mới
-> tạo VPS/backend runtime mới
-> thay environment/secrets
-> chạy migrations
-> chạy seed/bootstrap NPP
-> deploy
-> chạy smoke test
```

Không phải sửa controller, use case, DTO, UI hoặc business rule để trỏ sang installation mới.

Yêu cầu cấp 2 — thiết kế sẵn:

- Domain/Application không import Supabase SDK, SQL, Express response hoặc Next.js response.
- Provider access nằm trong infrastructure adapters.
- Nếu sau này thay Supabase/PostgreSQL bằng backend/provider khác, implement adapter mới và chạy lại contract tests.
- Không cam kết hỗ trợ MySQL/MongoDB ngay; chỉ không tự khóa business logic vào provider hiện tại.

## 3. Installation context thay cho TenantContext

Mỗi request nghiệp vụ chạy trong context của deployment hiện tại:

```ts
InstallationContext {
  installationId
  distributorCode
  actorId
  employeeId?
  branchIds
  warehouseIds
  territoryIds
  roles
  permissions
  requestId
}
```

Quy tắc:

1. `installationId` và `distributorCode` lấy từ cấu hình server, không lấy từ body client.
2. Actor lấy từ auth/session đã xác thực.
3. Branch/warehouse/territory scope lấy từ phân quyền nội bộ NPP.
4. Background job có system actor và installation context rõ ràng.
5. Service role/database admin chỉ là credential hạ tầng, không thay thế business permission.
6. Request mới không cần `tenantId`, `membershipId` hoặc tenant selector.

## 4. Cấu hình phải tách khỏi source

Không hardcode thông tin NPP, endpoint hoặc secret trong business code.

Nhóm environment/deployment config tối thiểu:

```text
APP_ENV
APP_NAME
NPP_CODE
APP_DOMAIN
PUBLIC_API_BASE_URL
BACKEND_PORT
INSTALLATION_ID
DATABASE_URL hoặc SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY (backend only)
STORAGE_CONFIG
AUTH_CONFIG
CORS_ALLOWED_ORIGINS
LOG_LEVEL
```

Nhóm business settings nằm trong DB/seed có schema rõ ràng:

```text
Tên pháp lý và tên hiển thị NPP
Logo/thương hiệu
Timezone/currency
Chi nhánh và kho mặc định
Định dạng mã chứng từ
Chính sách đơn hàng
Chính sách tồn kho
Chính sách công nợ
Hạn mức và phê duyệt
Module/tính năng được bật
```

Quy tắc:

- Secret không commit vào source.
- Frontend không chứa service-role key hoặc DB credential.
- Source clone mới không được giữ URL/ID/secret của NPP cũ.
- Cấu hình ảnh hưởng nghiệp vụ phải validate và có version/effective date khi cần.

## 5. Data model cho một NPP độc lập

Không thêm `tenant_id` mặc định chỉ để chuẩn bị cho mô hình không sử dụng.

Bảng nghiệp vụ vẫn phải có:

```text
id
created_at
updated_at
created_by
updated_by
source_type/source_id khi có nguồn tích hợp
version hoặc optimistic lock khi có concurrent mutation
```

Unique/FK/index được thiết kế trong phạm vi database của NPP:

```text
unique(order_number)
unique(source_type, source_id, operation) khi cần idempotency
FK customer/product/warehouse phải hợp lệ trong cùng installation
```

Nếu tương lai thật sự chuyển sang shared SaaS, đó là phase kiến trúc mới có migration riêng; không âm thầm thêm tenant logic vào phase hiện tại.

## 6. Phân lớp backend bắt buộc

```text
HTTP/Transport
  -> Application use cases
    -> Domain rules/invariants
      -> Ports/interfaces
        -> Infrastructure adapters
           - Supabase/PostgreSQL adapter hiện tại
           - Auth adapter
           - Storage adapter
           - Queue/event adapter
           - Adapter khác trong tương lai
```

### 6.1 Domain/Application

- Không import provider SDK hoặc SQL.
- Nhận/trả model và DTO trung tính.
- Chứa transition, invariant, idempotency policy và transaction intent.
- Không trả lỗi provider ra public API.
- Không rẽ business rule theo provider.

Cấm:

```ts
if (provider === "supabase") businessRuleA()
else businessRuleB()
```

### 6.2 Ports

Tối thiểu dự kiến:

```ts
OrderRepository
CustomerRepository
ProductRepository
InventoryRepository
ReceivableRepository
TransactionManager
IdempotencyStore
AuditEventStore
ObjectStorage
IdentityProvider
Clock
IdGenerator
```

Port mô tả năng lực nghiệp vụ, không mô tả tên bảng, RPC hoặc cú pháp provider.

### 6.3 Adapters

Adapter chịu trách nhiệm:

- map domain model <-> provider schema;
- SQL/query/RPC/provider SDK;
- transaction implementation;
- normalize unique/FK/timeout/concurrency errors;
- pagination và storage implementation;
- health/observability của provider.

Có thể tận dụng Supabase RPC cho transaction hiện tại, nhưng hành vi nghiệp vụ phải được khóa bằng application/domain tests để có thể reimplement ở backend khác.

## 7. API contract trung tính

Success:

```json
{
  "data": {},
  "receivedAt": "2026-07-14T00:00:00.000Z",
  "requestId": "req_..."
}
```

Error:

```json
{
  "error": {
    "code": "ORDER_ALREADY_CONFIRMED",
    "message": "Đơn hàng đã được xác nhận.",
    "details": {},
    "retryable": false
  },
  "receivedAt": "2026-07-14T00:00:00.000Z",
  "requestId": "req_..."
}
```

Cấm trả trực tiếp:

```text
Supabase/PostgREST/PostgreSQL error nguyên bản
tên bảng/cột/RPC
stack trace
provider URL/credential
SELECT * row chưa qua mapper
```

Frontend chỉ phụ thuộc public API contract; đổi backend URL hoặc provider không làm đổi DTO/behavior.

## 8. Migration là nguồn sự thật của database

Một database trắng phải dựng được hoàn toàn từ repository:

```text
migrations
-> functions/triggers/policies/grants
-> seed/bootstrap bắt buộc
-> smoke fixtures riêng cho test
```

Quy tắc:

1. Không sửa DB production thủ công rồi bỏ quên migration.
2. Không sửa migration đã chạy; tạo migration mới.
3. Schema, RPC, trigger, policy và grant đang dùng phải có bản tương ứng trong repo.
4. Seed business mặc định phải idempotent.
5. Dữ liệu demo/test không được trộn vào production seed.
6. Migration phải chạy được trên DB trắng và trên DB có dữ liệu cũ theo kế hoạch forward-fix.
7. Backup/restore không thay thế migration/bootstrap contract.

## 9. Backend deployment phải tái tạo được

Source phải chứa hoặc tài liệu hóa đầy đủ:

```text
runtime requirements
build command
start command
process manager config
required environment variables
health endpoint
migration command
seed/bootstrap command
smoke command
rollback/forward-fix procedure
```

Không hardcode IP, đường dẫn VPS hoặc domain production trong domain/application code. Các giá trị runtime hiện tại chỉ thuộc deployment documentation/config.

## 10. Quy trình tạo một NPP mới

```text
1. Tạo repo/branch/source clone từ template đã khóa.
2. Tạo Supabase/PostgreSQL project mới.
3. Tạo backend/VPS/runtime mới.
4. Tạo frontend project/domain mới.
5. Tạo secrets và environment riêng.
6. Chạy migrations trên DB trắng.
7. Chạy bootstrap NPP, owner/admin, chi nhánh và kho ban đầu.
8. Deploy backend rồi kiểm tra health.
9. Deploy frontend với API URL mới.
10. Chạy contract/smoke tests.
11. Kiểm tra source/config không còn tham chiếu installation gốc.
12. Lập backup và bàn giao thông tin vận hành.
```

Không copy nguyên database NPP cũ rồi xóa dữ liệu thủ công để tạo NPP mới.

## 11. Auth và phân quyền trong một NPP

Tách rõ:

```text
identity/user = tài khoản đăng nhập
employee      = hồ sơ nhân viên nghiệp vụ
role          = nhóm quyền
permission    = hành động
scope         = chi nhánh/kho/khu vực/tuyến/khách/team/self
policy        = hạn mức và điều kiện phê duyệt
```

Không cần:

```text
tenant membership
tenant switch
platform admin cross-tenant
tenant installation assignment
```

Mỗi installation có owner/admin nội bộ của chính NPP đó.

## 12. MCP v1 trong source template

MCP v1 vẫn frozen và chạy trên DB/backend hiện tại.

Khi chuẩn bị source template để clone:

1. Toàn bộ schema/function/policy/grant MCP phải nằm trong migrations.
2. Không hardcode project ID, URL, route/customer ID hoặc dữ liệu production.
3. Seed chỉ tạo cấu hình nền cần thiết; dữ liệu tuyến/khách thật nhập riêng.
4. Contract MCP v1 giữ nguyên.
5. DB mới phải chạy full MCP smoke sau bootstrap.

Không cần migrate MCP sang multi-tenant.

## 13. Test matrix portability

```text
[ ] DB trắng chạy toàn bộ migrations thành công
[ ] Seed/bootstrap chạy lặp không duplicate
[ ] Backend mới khởi động chỉ bằng environment mới
[ ] Frontend mới chỉ cần API/config mới, không sửa business code
[ ] Không còn URL/project ID/secret của installation gốc trong clone
[ ] Repository contract tests pass trên adapter hiện tại
[ ] Canonical API tests pass
[ ] Public API không lộ provider/schema error
[ ] Actor/permission/scope được backend enforce
[ ] Anon/browser không mutation trực tiếp bảng nghiệp vụ quan trọng
[ ] Retry mutation không duplicate
[ ] Backup/restore smoke pass
[ ] Full MCP smoke pass trên DB mới
[ ] Order smoke pass trên DB mới khi Order Core được triển khai
[ ] Clone rehearsal tạo được installation thứ hai độc lập
```

## 14. Foundation Slice F0 đã điều chỉnh

```text
F0.1 Audit mọi hardcode URL/project ID/path/config
F0.2 Chuẩn hóa InstallationContext + actor/requestId/auth
F0.3 Tách application/use case khỏi Supabase bằng ports/adapters
F0.4 Chuẩn hóa canonical success/error DTO
F0.5 Audit consumer rồi khóa mutation DB trực tiếp
F0.6 Đối chiếu DB production với toàn bộ migrations/functions/policies/grants trong repo
F0.7 Tạo bootstrap/seed/config schema cho một NPP mới
F0.8 Làm sạch order legacy + constraint + idempotency
F0.9 Chạy clean-DB migration rehearsal
F0.10 Clone source và deploy thử installation thứ hai
```

Không bắt đầu full Order Core trước khi F0.1-F0.9 đạt. F0.10 là portability gate trước khi coi source đủ điều kiện bán/copy cho NPP khác.

## 15. Definition of Done

Foundation chỉ được khóa khi:

- source clone không cần sửa business code để dùng DB/backend mới;
- DB trắng dựng được bằng migrations + bootstrap;
- backend mới chạy được chỉ bằng config/secrets mới;
- frontend không phụ thuộc provider/schema;
- domain/application không import provider SDK;
- public API dùng DTO/error trung tính;
- mutation quan trọng chỉ qua backend;
- actor/permission/audit hoạt động;
- repository/canonical API/smoke tests pass;
- MCP v1 vẫn pass trên installation mới;
- có tài liệu deploy, backup, restore và forward-fix;
- không còn yêu cầu shared multi-tenant trong foundation hiện tại.

## 16. Quyết định đã khóa

```text
[D-01] Mỗi NPP có một source clone/deployment độc lập.
[D-02] Mỗi NPP có backend, database, storage và config riêng.
[D-03] Không bắt buộc tenant_id hoặc tenant membership trong phase hiện tại.
[D-04] Supabase/PostgreSQL là adapter hiện tại, không phải public/domain contract.
[D-05] Portability ưu tiên dựng installation mới cùng stack bằng env+migration+seed.
[D-06] Không hardcode thông tin NPP/hạ tầng trong business code.
[D-07] Database migrations là nguồn sự thật để dựng DB mới.
[D-08] MCP v1 giữ frozen và phải tái tạo được trên DB mới.
[D-09] Chỉ bắt đầu Order Core sau foundation portability tối thiểu.
[D-10] Shared SaaS/multi-tenant chỉ xem xét ở phase mới nếu có yêu cầu kinh doanh thật.
```