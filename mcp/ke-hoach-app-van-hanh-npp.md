# Kế hoạch phát triển App vận hành Nhà phân phối

> Trạng thái: **ACTIVE MASTER PLAN**  
> Bắt đầu phase: **2026-07-14**  
> MCP v1: **CORE COMPLETE / FROZEN**  
> Tài liệu khóa MCP: [`MCP_EXECUTION_PLAN.md`](./MCP_EXECUTION_PLAN.md)  
> Foundation bắt buộc: [`docs/npp-plan/FOUNDATION_SINGLE_NPP_PORTABILITY.md`](./docs/npp-plan/FOUNDATION_SINGLE_NPP_PORTABILITY.md)

## 1. Tuyên bố chuyển phase

MCP v1 đã hoàn chỉnh luồng lõi:

```text
Tuyến -> Phiên -> Khách trong phiên -> Đơn hàng -> Thử sản phẩm
-> Báo cáo thị trường -> Follow-up -> Báo cáo phiên
```

Từ thời điểm này:

1. **Đóng phase phát triển lõi MCP, không đóng module MCP.**
2. Contract và logic dữ liệu MCP v1 không được thay đổi tùy tiện.
3. MCP chỉ được sửa khi có lỗi thật, vấn đề hiệu năng, bảo mật hoặc nâng cấp có migration/version/smoke test rõ ràng.
4. Trọng tâm chuyển sang **MCP-Plan như một ứng dụng quản lý NPP hoàn chỉnh**.
5. MCP trở thành một phân hệ vận hành thị trường trong App NPP.
6. Sản phẩm được phát triển từ một source template gốc, sau đó clone thành installation độc lập cho từng NPP.

## 2. Mô hình bán và triển khai đã khóa

```text
Source template gốc
├── frontend
├── backend
├── domain/application
├── adapters
├── migrations
├── bootstrap/seed
└── tests

NPP A: source clone A -> backend A -> database A -> storage/config A
NPP B: source clone B -> backend B -> database B -> storage/config B
```

Quyết định:

- Mỗi NPP có source clone/deployment riêng.
- Mỗi NPP có frontend, backend, database, storage, domain và secret riêng.
- DB/backend hiện tại tiếp tục dùng để phát triển và test sản phẩm gốc.
- Khi bán cho NPP mới, không dùng chung DB/backend hiện tại; dựng installation mới từ source gốc.
- Không triển khai shared SaaS/multi-tenant trong phase hiện tại.
- Không bắt buộc `tenant_id`, tenant selector, tenant membership hoặc platform admin cross-NPP.
- Portability cấp bắt buộc là thay instance DB/backend cùng stack bằng environment + migration + seed + deploy.
- Domain/application vẫn phải tách provider qua ports/adapters để không khóa logic vào Supabase/VPS hiện tại.

Chi tiết: [`FOUNDATION_SINGLE_NPP_PORTABILITY.md`](./docs/npp-plan/FOUNDATION_SINGLE_NPP_PORTABILITY.md).

## 3. Bản đồ module App NPP

```text
Tổng quan điều hành
-> Khách hàng
-> Sản phẩm
-> Đơn hàng
-> Tồn kho
-> Công nợ
-> Nhân viên
-> Kế hoạch
-> Báo cáo
-> Cài đặt và phân quyền
```

| Mã | Module | Plan | Trạng thái |
|---|---|---|---|
| FOUNDATION | Single-NPP deployment portability | [`docs/npp-plan/FOUNDATION_SINGLE_NPP_PORTABILITY.md`](./docs/npp-plan/FOUNDATION_SINGLE_NPP_PORTABILITY.md) | **Required first** |
| NPP-00 | Tổng quan điều hành | [`docs/npp-plan/00-tong-quan-dieu-hanh.md`](./docs/npp-plan/00-tong-quan-dieu-hanh.md) | Planned |
| NPP-01 | Khách hàng | [`docs/npp-plan/01-khach-hang.md`](./docs/npp-plan/01-khach-hang.md) | Planned |
| NPP-02 | Sản phẩm | [`docs/npp-plan/02-san-pham.md`](./docs/npp-plan/02-san-pham.md) | Planned |
| NPP-03 | Đơn hàng | [`docs/npp-plan/03-don-hang.md`](./docs/npp-plan/03-don-hang.md) | **Priority 1 / Design first** |
| NPP-04 | Tồn kho | [`docs/npp-plan/04-ton-kho.md`](./docs/npp-plan/04-ton-kho.md) | Planned |
| NPP-05 | Công nợ | [`docs/npp-plan/05-cong-no.md`](./docs/npp-plan/05-cong-no.md) | Planned |
| NPP-06 | Nhân viên | [`docs/npp-plan/06-nhan-vien.md`](./docs/npp-plan/06-nhan-vien.md) | Planned |
| NPP-07 | Kế hoạch | [`docs/npp-plan/07-ke-hoach.md`](./docs/npp-plan/07-ke-hoach.md) | Planned |
| NPP-08 | Báo cáo | [`docs/npp-plan/08-bao-cao.md`](./docs/npp-plan/08-bao-cao.md) | Planned |
| NPP-09 | Cài đặt và phân quyền | [`docs/npp-plan/09-cai-dat-phan-quyen.md`](./docs/npp-plan/09-cai-dat-phan-quyen.md) | Foundation |

## 4. Kiến trúc mục tiêu bắt buộc

Supabase/VPS hiện tại là infrastructure đang dùng, không phải domain architecture.

```text
Browser/PWA
  -> Public API contract / Next.js proxy
    -> Backend transport/controllers
      -> Application use cases
        -> Domain rules/invariants
          -> Ports/interfaces
            -> Infrastructure adapters
               - Supabase/PostgreSQL hiện tại
               - Auth provider
               - Object storage
               - Queue/event
               - Adapter khác trong tương lai
```

Runtime hiện tại:

```text
Browser/PWA
-> Next.js/Vercel proxy
-> VPS backend
-> Supabase/PostgreSQL
```

Nguyên tắc:

1. Frontend không tự quyết định logic nghiệp vụ quan trọng.
2. Mutation đơn hàng, kho, công nợ, quyền và audit phải chạy qua backend.
3. Mỗi thay đổi schema phải có migration; không sửa DB thủ công rồi bỏ quên source.
4. Không chắp vá theo triệu chứng; tái hiện lỗi, tìm đúng tầng, sửa logic và thêm test hồi quy.
5. Không dùng một status để gánh nhiều loại sự thật.
6. Dữ liệu đã ảnh hưởng kho/công nợ không hard-delete; dùng hủy, đảo bút toán hoặc chứng từ điều chỉnh.
7. Mutation có nguy cơ gọi lặp phải idempotent.
8. Thao tác quan trọng phải có actor, thời gian và audit/event log.
9. Báo cáo đọc từ nguồn sự thật hoặc read model tái tạo được.
10. Triển khai theo vertical slice: migration -> backend -> UI -> test -> deploy -> smoke.
11. Mỗi request mới có `InstallationContext`, actor, quyền/scope và `requestId` do backend xác thực.
12. `installationId` và mã NPP lấy từ server config, không tin body client.
13. Domain/application không import Supabase SDK, SQL, Express/Next response.
14. Public API chỉ trả DTO/error trung tính, không lộ bảng, RPC hoặc provider error.
15. RLS là defense-in-depth; backend permission vẫn bắt buộc.
16. Service role không phải business permission.
17. Adapter mới phải chạy repository contract và canonical API tests.
18. Một DB trắng phải dựng được hoàn toàn từ migrations + bootstrap/seed trong repo.
19. Không hardcode tên NPP, project ID, URL, IP, domain hoặc secret trong business code.
20. Source clone mới phải chạy được chỉ bằng cấu hình hạ tầng mới, không sửa business logic.

## 5. Installation context và cấu hình

Context request trung tính:

```text
installationId
distributorCode
actorId
employeeId nếu có
branch/warehouse/territory scope
roles/permissions/policies
requestId
```

Cấu hình deployment tối thiểu:

```text
APP_NAME
NPP_CODE
APP_DOMAIN
PUBLIC_API_BASE_URL
INSTALLATION_ID
DATABASE_URL hoặc SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY (backend only)
STORAGE_CONFIG
AUTH_CONFIG
CORS_ALLOWED_ORIGINS
```

Cấu hình nghiệp vụ nằm trong DB/seed có schema rõ ràng:

```text
Thông tin NPP
Chi nhánh/kho
Timezone/currency
Number sequence
Order/inventory/receivable policies
Approval thresholds
Branding/module settings
```

Không cần tenant selector hoặc membership nhiều NPP trong cùng deployment.

## 6. Tách miền dữ liệu

```text
MCP market operations
Customer master
Product catalog and pricing
Sales order
Fulfillment and delivery
Inventory ledger
Receivables and payment
Employee and responsibility
Planning and action
Reporting snapshots/read models
Identity, role and permission
Installation configuration
Audit and configuration
```

Quy tắc:

- MCP có thể là nguồn tạo đơn/follow-up/tín hiệu nhưng không sở hữu toàn bộ order lifecycle.
- Đơn hàng là nguồn yêu cầu bán.
- Giao hàng là nguồn sự thật số lượng thực giao.
- Inventory ledger là nguồn sự thật nhập/xuất/giữ/điều chỉnh.
- Receivable ledger là nguồn sự thật phải thu/thu/hoàn/bù trừ.
- Dashboard/report chỉ đọc từ nguồn sự thật hoặc read model tái tạo được.
- Installation quyết định kết nối DB/backend nào, không đổi ý nghĩa nghiệp vụ.

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

## 8. Thứ tự triển khai đúng

### Phase A — Foundation portability cho một NPP/deployment

```text
A1. Audit auth/user/role, URL/project ID/path/config hardcode
A2. Chốt InstallationContext + actor/requestId
A3. Chốt canonical success/error DTO
A4. Chốt repository/transaction/idempotency/audit ports
A5. Audit consumer rồi khóa mutation DB trực tiếp
A6. Đối chiếu production DB với migrations/functions/policies/grants trong repo
A7. Chốt bootstrap/seed/config cho một NPP mới
A8. Chốt money, quantity, unit, timezone và document numbering
A9. Chốt permission matrix tối thiểu
A10. Chạy clean-DB migration rehearsal
A11. Clone/deploy thử installation thứ hai
```

Không code mutation lõi mới trước A2-A7. Không coi source đủ điều kiện bán trước khi A10-A11 pass.

### Phase B — Master data tối thiểu

```text
B1. Khách hàng
B2. Sản phẩm, biến thể, đơn vị quy đổi
B3. Bảng giá/chiết khấu tối thiểu
B4. Kho và vị trí kho tối thiểu
B5. Nhân viên phụ trách tối thiểu
```

### Phase C — Đơn hàng lõi

```text
C1. Contract vòng đời đơn
C2. Dòng đơn và tính tiền
C3. Sửa/hủy có version và audit
C4. Giao đủ/giao thiếu/giao nhiều lần
C5. Trả hàng/đổi hàng
C6. Liên kết tồn kho và công nợ
C7. Repository/canonical API/concurrency tests
```

### Phase D — Tồn kho và giao nhận

```text
D1. Inventory ledger
D2. Reservation/allocation
D3. Pick/pack/ship/deliver
D4. Partial delivery/backorder
D5. Return-to-stock/damaged/quarantine
D6. Stocktake/adjustment/transfer
```

### Phase E — Công nợ

```text
E1. Receivable posting
E2. Payment allocation
E3. Partial payment/overpayment
E4. Refund/credit note/offset
E5. Aging and credit limit
```

### Phase F — Điều hành và mở rộng

```text
F1. Dashboard/read models
F2. Nhân viên và hiệu suất
F3. Kế hoạch/action
F4. Báo cáo
F5. Cài đặt/phân quyền hoàn chỉnh
F6. Installer/bootstrap/backup/restore/deployment documentation
```

## 9. Quy tắc đặc biệt cho đơn hàng

Tối thiểu tách:

```text
order_status
fulfillment_status
payment_status
```

Các trường hợp phải thiết kế trước khi code:

1. Sửa draft.
2. Sửa sau xác nhận bằng amendment/version.
3. Hủy toàn đơn trước giao.
4. Hủy một phần dòng.
5. Giao thiếu.
6. Khách nhận một phần.
7. Giao nhiều đợt.
8. Backorder.
9. Đổi sản phẩm trước giao.
10. Đổi sau giao.
11. Trả toàn bộ/một phần.
12. Hàng hỏng/hết hạn/quarantine.
13. Điều chỉnh giá/chiết khấu sau xác nhận.
14. Hoàn tiền/bù trừ công nợ.
15. Đơn từ MCP retry không duplicate.
16. Canonical order DTO không đổi khi chuyển sang backend/DB instance mới.
17. DB mới phải chạy cùng order contract tests.

Plan chi tiết: [`docs/npp-plan/03-don-hang.md`](./docs/npp-plan/03-don-hang.md).

## 10. Mẫu theo dõi mỗi module

```text
1. Mục tiêu/phạm vi
2. Ngoài phạm vi
3. Nguồn dữ liệu hiện có
4. Installation/config dependency
5. Contract cần khóa
6. Canonical request/response DTO
7. Data model/migration
8. Ports/adapters
9. Backend API
10. UI/UX
11. Permission matrix
12. Audit/event log
13. Repository/API/concurrency tests
14. Migration/backfill
15. Bootstrap/seed nếu có
16. Deploy/smoke/rollback/forward-fix
17. Open questions
18. Decision log
19. Checklist trạng thái
```

Trạng thái task:

```text
TODO -> DESIGNING -> CONTRACT LOCKED -> IMPLEMENTING
-> REVIEW -> VERIFIED -> DEPLOYED -> FROZEN
```

Không đánh dấu hoàn thành chỉ vì UI đã hiện; phải đủ DB, backend, permission, migration, tests và production smoke.

## 11. Definition of Ready

Một module chỉ code mutation khi:

- Đã audit bảng/API/UI hiện có.
- Đã vẽ happy path và ngoại lệ.
- Đã xác định nguồn sự thật.
- Đã chốt InstallationContext/config dependency.
- Đã chốt canonical DTO.
- Đã chốt port/repository và adapter hiện tại.
- Đã chốt trạng thái/transition.
- Đã chốt quyền/scope/threshold.
- Đã có migration và rollback/forward-fix plan.
- Đã có acceptance test.
- Không phụ thuộc hardcode của installation hiện tại.

## 12. Definition of Done

Một vertical slice hoàn thành khi:

- Migration chạy trên DB sạch và production-compatible.
- Backend áp dụng transaction/idempotency đúng.
- Frontend không bypass backend mutation.
- Permission deny-by-default hoạt động.
- Domain/application không phụ thuộc provider SDK.
- Public API không lộ schema/provider.
- Repository/canonical API tests pass.
- Audit/event đầy đủ.
- Unit/integration/concurrency/security tests pass.
- Build pass.
- Deploy đúng phần liên quan.
- Production smoke pass.
- Cùng slice chạy được trên installation test mới chỉ bằng config mới.
- Tài liệu/decision log được cập nhật.

## 13. Quy tắc thay đổi contract

1. Ghi lý do nghiệp vụ.
2. Xác định dữ liệu cũ và installation bị ảnh hưởng.
3. Phân biệt domain change với adapter/config change.
4. Tạo migration/version mới.
5. Cập nhật canonical API nếu behavior/output đổi.
6. Không fork business rule theo NPP hoặc provider.
7. Thêm test hồi quy/repository/API tests.
8. Có deploy và rollback/forward-fix plan.
9. Cập nhật module/foundation/master plan.
10. Không sửa âm thầm để chữa riêng một màn hình hay một NPP.

## 14. Mốc triển khai gần nhất

```text
[x] NPP-F00 Audit Foundation/Auth/Order hiện tại
[ ] NPP-F01 Audit hardcode URL/project ID/path/config
[ ] NPP-F02 Chốt InstallationContext + actor/requestId/auth
[ ] NPP-F03 Chốt canonical response/error DTO
[ ] NPP-F04 Chốt repository/transaction/idempotency/audit ports
[ ] NPP-F05 Audit consumer và khóa direct DB mutation
[ ] NPP-F06 Đối chiếu production DB với migrations/functions/policies/grants
[ ] NPP-F07 Chốt bootstrap/seed/config cho NPP mới
[ ] NPP-F08 Chạy clean-DB migration rehearsal
[ ] NPP-F09 Làm sạch order legacy + constraint/idempotency
[ ] NPP-F10 Khóa order lifecycle/transition matrix
[ ] NPP-F11 Implement order draft -> confirmed
[ ] NPP-F12 Fulfillment + partial delivery/backorder
[ ] NPP-F13 Receivable/payment
[ ] NPP-F14 Return/exchange
[ ] NPP-F15 Clone/deploy installation test thứ hai
[ ] NPP-F16 Hoàn thiện installer/backup/restore/bàn giao
```

## 15. Kết luận

```text
MCP v1 = frozen core, tiếp tục là module vận hành thị trường.
MCP-Plan = source template App quản lý NPP hoàn chỉnh.
Mỗi NPP = source clone + frontend/backend/DB/storage/config riêng.
Portability = env + migration + seed + adapters + contract tests.
Không shared multi-tenant trong phase hiện tại.
Đơn hàng = miền ưu tiên số 1 sau Foundation Slice F0.
```