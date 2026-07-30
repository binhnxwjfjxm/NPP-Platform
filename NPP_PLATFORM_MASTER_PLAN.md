# NPP Platform — Master Implementation Plan

> Trạng thái: **ACTIVE MASTER PLAN**  
> Phạm vi: **Toàn bộ nền tảng MCP Field + NPP Core**  
> Repo: `binhnxwjfjxm/NPP-Platform`  
> Cập nhật: `2026-07-30`  
> Nguyên tắc: **Không chắp vá khi lỗi; phải tái hiện, tìm nguyên nhân gốc, sửa đúng tầng và thêm test hồi quy.**

---

## 0. Quyền ưu tiên và tài liệu liên quan

Tài liệu này là kế hoạch điều phối cấp cao và nguồn ưu tiên của repo.

Khi có mâu thuẫn về kiến trúc, hạ tầng, domain ownership hoặc thứ tự triển khai, tài liệu này ưu tiên hơn các plan MCP/module cũ.

Các tài liệu cũ vẫn được giữ trong Git để làm lịch sử quyết định và nguồn nghiệp vụ. Không xóa một quyết định đúng chỉ vì tài liệu cũ không còn là master.

Tài liệu quyết định đang hoạt động:

```text
docs/operations/pre-phase-6-closure-audit.md
docs/operations/phase-6-sales-mcp-customer-boundary.md
docs/operations/phase-6-transportation-dispatch-decisions.md
```

Tài liệu implementation của từng vertical slice phải dẫn ngược về Master Plan và decision document tương ứng.

---

## 1. Mục tiêu sản phẩm

NPP Platform gồm hai ứng dụng người dùng độc lập, cùng một installation và dùng chung chuẩn định danh, xác thực, hợp đồng API, audit/outbox và PostgreSQL:

```text
NPP Platform
├── MCP Field
│   ├── Field routes và field outlets
│   ├── Phiên làm việc ngoài thị trường
│   ├── Check-in/GPS/hình ảnh
│   ├── Test/khảo sát/báo cáo thị trường
│   ├── Follow-up và action
│   ├── Đề nghị mở mã khách hàng
│   └── Tạo yêu cầu/đơn qua Core khi outlet đã liên kết
│
└── NPP Core
    ├── Tổ chức, người dùng và phân quyền
    ├── Khách hàng, nhà cung cấp và địa chỉ
    ├── Sản phẩm/SKU/đơn vị/bảng giá
    ├── Mua hàng, nhập hàng và phải trả
    ├── Bán hàng, fulfillment và phải thu
    ├── Kho, ledger, reservations và returns
    ├── Delivery Order và Transportation/Dispatch
    ├── Thanh toán, giá vốn và báo cáo
    └── Audit, outbox và vận hành hệ thống
```

### 1.1 MCP là app hiện hữu, không phải greenfield

MCP Field là ứng dụng tác nghiệp thị trường đã có code, UI và dữ liệu nguồn.

Chiến lược MCP:

```text
giữ luồng/UI đã đúng
-> audit legacy data và identity
-> hoàn thiện backend-owned write model
-> thay adapter Supabase/VPS cũ
-> chuẩn hóa customer/order boundary
-> gọi canonical Core API
-> migrate/cut over sau reconciliation
```

Không xây lại MCP chỉ để giống AppShell của Core. Không đồng thời đổi toàn bộ UI, domain model và data provider trong một commit lớn.

### 1.2 Core là nguồn sự thật nghiệp vụ chính thức

NPP Core sở hữu customer chính thức, document lifecycle, inventory ledger, purchasing, sales, logistics, receivable/payable và accounting operations.

MCP không tự post kho, công nợ, giao hàng hoặc thanh toán.

---

## 2. Kiến trúc đã khóa

### 2.1 Một repo tổng

```text
NPP-Platform/
├── .github/
├── mcp/
├── npp-core/
├── packages/
├── database/
├── docs/
└── NPP_PLATFORM_MASTER_PLAN.md
```

- Một `.git` tại root.
- MCP và Core không có Git riêng.
- Không di chuyển path lớn nếu không có migration path và lý do kỹ thuật rõ ràng.

### 2.2 Hai frontend

```text
MCP frontend       mobile/PWA, GPS, camera, offline có kiểm soát
NPP Core frontend  desktop/web, bảng dữ liệu, đối soát, Excel/PDF/in
```

Không ép hai UX vào một AppShell duy nhất.

### 2.3 Hai backend service

```text
MCP API
NPP Core API
```

- Mỗi backend chỉ ghi domain mình sở hữu.
- Không ghi trực tiếp bảng của backend còn lại.
- Giao tiếp qua canonical API và event/outbox có idempotency.
- Chia sẻ contracts/types/test helpers trong monorepo.

### 2.4 Một PostgreSQL cluster cho installation hiện tại

Schema mục tiêu:

```text
shared
mcp
sales
purchasing
inventory
logistics
accounting
reporting
```

- Một database không có nghĩa là mọi service được ghi mọi bảng.
- Quyền DB phải giới hạn theo service role/schema.
- Một khách hàng triển khai là một installation độc lập với runtime, secret, database và storage riêng.

### 2.5 Hạ tầng mục tiêu

```text
Vercel
├── MCP frontend
└── NPP Core frontend

Heroku
├── MCP backend
├── NPP Core backend
└── PostgreSQL

Cloudflare R2
├── field media
├── POD/giao nhận
├── PDF/Excel
├── import/export
└── backup ngoài DB
```

Supabase/VPS là hạ tầng nguồn MCP cũ, không phải kiến trúc đích.

### 2.6 Production separation

Source merge không đồng nghĩa production đã deploy hoặc migration đã chạy.

Mọi production rollout là operation riêng và phải audit lại:

```text
provider state
backup
restore rehearsal
migration manifest
pre/post reconciliation
deploy
smoke
rollback/forward-fix
```

Không tự suy đoán trạng thái provider từ trạng thái GitHub.

---

## 3. Nguyên tắc kỹ thuật bắt buộc

1. Backend sở hữu business logic quan trọng.
2. Frontend không mutation database trực tiếp.
3. Schema change phải có migration trong repo.
4. Mutation có nguy cơ retry phải idempotent.
5. Chứng từ đã post không sửa/xóa; sai dùng reversal/adjustment.
6. Inventory ledger là nguồn sự thật tồn kho.
7. Receivable/payable ledgers là nguồn sự thật công nợ.
8. Balance và dashboard là rebuildable read models.
9. Tách `order_status`, `fulfillment_status`, `delivery_status`, `payment_status`.
10. Audit phải có actor, request ID, source và before/after phù hợp.
11. Vertical slice: migration → backend → UI → tests → CI → merge → deploy riêng.
12. Không hardcode installation, URL, IP, project ID hoặc secret trong business logic.
13. DB sạch phải dựng được từ migrations + bootstrap/seed.
14. Quantity/money dùng decimal chính xác, không dùng JavaScript float làm nguồn nghiệp vụ.
15. Public API không trả raw provider/DB error, SQL, stack trace hoặc secret.
16. Không code UI trước khi khóa source of truth, lifecycle và permission.

---

## 4. Domain ownership

### 4.1 Shared domain

```text
installations/config
users, roles, permissions
employees
branches, warehouses, locations
customers and customer addresses
suppliers and supplier addresses
products, variants/SKU
units, conversions, barcodes
price lists and pricing foundation
document numbering
audit metadata
```

`shared.customers.id` là canonical Core customer ID.

### 4.2 MCP domain

```text
field routes
field outlets
field route-outlet assignments
field route sessions
session outlet snapshots
visits/check-in
field tests
market reports
follow-ups
field media
local/offline onboarding drafts
Core request/order references and read models
MCP action logs
```

MCP không sở hữu:

```text
Core customers chính thức
inventory balances/movements
official Sales Orders
Delivery Orders
vehicles/drivers/trips/dispatch
official receivables/payables
posted goods receipts/deliveries
costing entries
COD accounting allocation
```

### 4.3 Sales domain

```text
Sales Orders and lines
order versions/amendments
allocations/fulfillments
Delivery Orders and lines
customer returns/exchanges
sales credit/debit adjustments
customer onboarding review requests
```

### 4.4 Purchasing domain

```text
Purchase Orders and lines
Goods Receipts and lines
quantity/quality variance
supplier returns
purchase adjustments
supplier invoice/reference documents
```

### 4.5 Inventory domain

```text
immutable inventory ledger
movement lines and reversal
reservations
balances/read models
lots/expiry
opening balances
stocktakes and adjustments
warehouse transfers
in-transit stock
quarantine/scrap
```

### 4.6 Logistics domain

```text
delivery routes
vehicles
driver profiles
trip crew members
delivery trips
trip stops
delivery-order assignments
delivery attempts
proof-of-delivery references
dispatch audit/events
```

`field_route` và `delivery_route` là hai domain khác nhau. `delivery_trip` là một chuyến cụ thể, không phải route master.

### 4.7 Accounting operations domain

Phase đầu không xây general ledger đầy đủ. Core tối thiểu sở hữu:

```text
receivables and ledger
payments received and allocations
payables and ledger
supplier payments and allocations
credits/debits
refunds, overpayments, write-offs
COD receipt/allocation references
cash/bank references
costing entries
```

---

## 5. Nguồn sự thật

```text
Khách chính thức                   -> shared.customers
Điểm ghé/khách tuyến MCP           -> mcp field outlet
Khách đặt gì                       -> Sales Order
Nhu cầu giao hàng                  -> Delivery Order
Kế hoạch/chuyến giao               -> delivery trip + assignment
Kết quả từng lần giao              -> delivery attempt
Số lượng thực giao/xuất            -> posted inventory movement
NPP đặt mua gì                     -> Purchase Order
Thực tế nhận nhà cung cấp          -> Goods Receipt
Tồn kho                            -> inventory ledger
Tồn tổng hợp                       -> rebuildable balance
Khách còn nợ                       -> receivable ledger
NPP còn nợ nhà cung cấp            -> payable ledger
Đã thu/đã chi                      -> payment + allocation
Giá vốn                            -> costing entries
Ai làm gì                          -> audit/outbox
```

Cấm:

- sửa trực tiếp stock/debt;
- dùng `paid=true` thay payment allocation;
- xóa chứng từ đã post;
- dùng một status cho order, kho, giao và tiền;
- gắn vehicle/driver/trip trực tiếp lên Sales Order làm nguồn sự thật;
- coi mọi MCP outlet là Core customer.

---

## 6. Customer và MCP boundary

### 6.1 Core customer và field outlet

```text
Core customer     = customer chính thức trong shared.customers
MCP field outlet  = điểm ghé/prospect/điểm bán có identity riêng
```

Field outlet có thể lưu:

```text
core_customer_id nullable
core_customer_address_id nullable
```

Chỉ outlet đã link với Core customer đang hoạt động mới được tạo official Sales Order.

Outlet chưa link vẫn được check-in, test, survey, report, follow-up, ghi nhu cầu và gửi onboarding request.

### 6.2 Onboarding ownership

- MCP giữ local/offline draft trước submit.
- Sau submit, Core sở hữu canonical review lifecycle.
- MCP lưu Core request reference và synchronized status.
- Core approve tạo customer mới, link existing hoặc reject.
- Không để hai app cùng mutate một canonical request lifecycle.

Chi tiết: `docs/operations/phase-6-sales-mcp-customer-boundary.md`.

---

## 7. Inventory and fulfillment rules

Inventory scope tối thiểu:

```text
installation + warehouse + location + base SKU + lot khi có
```

```text
available = on_hand - reserved - blocked - quarantine
```

- Không cho âm kho mặc định.
- Reservation không được oversell khi concurrent.
- Posted movements bất biến; reversal append-only.
- Delivery issue và customer return phải gọi internal inventory posting contract.
- Không mở generic public inventory posting endpoint cho Sales/Purchasing bypass lifecycle.

Trước pick/pack của Phase 6 phải khóa:

```text
reservation -> allocation transition
manual lot selection hoặc policy selection
FEFO/FIFO eligibility
partial allocation/backorder
inventory issue transition
```

Vehicle/trip không phải warehouse/location trong Transportation foundation. Virtual vehicle location chỉ xem xét ở Phase 7 hoặc sau khi có nhu cầu thực tế.

---

## 8. Purchasing and payable baseline

Phase 5 source capabilities đã có trên `main`:

```text
Purchase Order lifecycle
scalable SKU search/bulk line entry
partial Goods Receipt
quantity/quality variance
inventory receipt posting/reversal
supplier return
payable posting and immutable ledger
supplier payment/allocation/reversal
```

Deferred không chặn Phase 6 source design:

```text
bank reconciliation
cashbook/general ledger
payment approval
FX/cross-currency allocation
```

Production rollout của migrations mới vẫn là operation riêng.

---

## 9. Sales, Delivery Order and Dispatch model

Tách bốn lớp:

```text
Sales Order
-> Fulfillment/Allocation
-> Delivery Order
-> Delivery Trip/Attempt
```

Quan hệ bắt buộc:

```text
1 Sales Order      -> nhiều Delivery Orders
1 Delivery Order   -> nhiều attempts/trips khi cần
1 Delivery Trip    -> nhiều Delivery Orders
1 trip stop        -> có thể chứa nhiều Delivery Orders theo policy
```

Partial delivery không tự completed. Phần còn lại phải chọn:

```text
backorder
reschedule
cancel remaining
approved amendment
```

Failed delivery không tự completed order và không được làm mất dấu stock đã issue.

Chi tiết: `docs/operations/phase-6-transportation-dispatch-decisions.md`.

---

## 10. API, auth, audit and events

### 10.1 API envelope

Success:

```json
{
  "data": {},
  "requestId": "req_...",
  "receivedAt": "..."
}
```

Error:

```json
{
  "error": {
    "code": "STABLE_CODE",
    "message": "Thông báo công khai có thể hành động.",
    "details": {},
    "retryable": false
  },
  "requestId": "req_...",
  "receivedAt": "..."
}
```

### 10.2 Request context

```text
installationId server-owned
actorId
employeeId nếu có
roles/permissions
branch/warehouse/territory scope
requestId
idempotencyKey khi cần
```

Không tin installation, role hoặc warehouse scope gửi tự do trong body.

### 10.3 Role foundation

Existing roles plus Phase 6 additions:

```text
owner/admin
sales manager
sales rep
warehouse manager/operator
purchasing
accounting receivable/payable
viewer/auditor
dispatcher
driver
logistics manager
```

Role không tự cấp mọi permission cùng tên. Authorization vẫn deny-by-default.

### 10.4 Event groups

```text
core.customer_onboarding.*
core.sales_order.*
core.delivery_order.*
core.delivery_trip.*
core.delivery_attempt.*
core.payment.*
core.customer.updated
core.product.updated
mcp.visit.completed
mcp.test.recorded
mcp.market_report.created
```

Event phải có event ID, aggregate ID/type, version, occurred time, source, actor và request correlation.

---

## 11. Trạng thái Phases 0–5

### Phase 0/1 — Repo and monorepo baseline

**Status:** absorbed into current repository baseline.

Repo, workspaces, app boundaries, migration structure và CI đang tồn tại trên `main`. Không mở lại như một phase xây mới nếu không có regression cụ thể.

### Phase 2 — Core foundation

**Source gate:** closed.

Có request context, auth/permission, idempotency, audit/outbox, migration runner, same-origin web gateway, sanitized errors và browser/migration CI.

### Phase 3 — Shared master data and access

**Source gate:** closed for current foundation.

Có organization, access/users/roles, customer, supplier, product/SKU/unit, pricing và document numbering.

Customer route assignment và MCP outlet linking được chuyển sang Phase 6 boundary, không phải backfill chắp vá vào customer master.

### Phase 4 — Inventory foundation

**Source gate:** closed for ledger/balance/reservation/lot-opening foundation.

Advanced transfer, stocktake, costing và vehicle virtual location vẫn thuộc Phase 7 hoặc decision riêng.

### Phase 5 — Purchasing and payable

**Source gate:** closed through supplier payment/allocation, gồm PO line-entry standardization.

Không suy ra production deploy/migration từ source gate.

Audit chi tiết: `docs/operations/pre-phase-6-closure-audit.md`.

---

## 12. Phase 6 roadmap

### Phase 6A — Sales and MCP boundary contract

Documentation/decision-only trước mutation:

```text
[ ] Core customer vs field outlet
[ ] customer/address link
[ ] source_type/source_id/idempotency
[ ] order/fulfillment/delivery/payment status axes
[ ] inventory issue transition
[ ] receivable posting transition
[ ] tax-inclusive/exclusive and rounding
[ ] credit override/approval
[ ] lot allocation/FEFO policy
[ ] cancellation/amendment boundaries
[ ] dispatch and COD boundaries
```

Gate: không tạo Sales mutation/schema trước khi owner khóa các quyết định này.

### Phase 6B — Sales Order Foundation

```text
[ ] draft/confirm/amend/cancel
[ ] Sales Order lines and snapshots
[ ] pricing/discount/tax
[ ] manual/import/API/MCP source references
[ ] linked active Core customer required
[ ] document numbering
[ ] idempotent source retry
[ ] permissions/audit/outbox
```

### Phase 6C — Customer Onboarding Bridge

```text
[ ] field outlet link contract
[ ] submit onboarding request
[ ] duplicate review
[ ] approve new customer/address
[ ] link existing customer/address
[ ] need-more-info/reject
[ ] status sync back to MCP
```

### Phase 6D — Fulfillment and Delivery Order

```text
[ ] reservation/allocation
[ ] pick/pack
[ ] lot/expiry selection
[ ] Delivery Orders and lines
[ ] partial fulfillment/backorder
[ ] inventory issue/reversal integration
[ ] return origin references
```

### Phase 6E — Transportation/Dispatch

```text
[ ] logistics schema
[ ] delivery routes
[ ] vehicles
[ ] drivers/trip crew
[ ] delivery trips/stops
[ ] Delivery Order assignments
[ ] dispatch/reassignment transitions
[ ] delivery attempts
[ ] POD foundation
[ ] failed/partial/rescheduled delivery
```

### Phase 6F — Receivable, Returns, Payment and COD

```text
[ ] receivable posting/reversal
[ ] payment/allocation/refund/write-off
[ ] customer return/exchange
[ ] COD collection fact
[ ] COD accounting allocation
[ ] order/fulfillment/delivery/payment projections
```

---

## 13. MCP adaptation track

MCP work runs as an adaptation/integration track, not a rebuild phase:

```text
M1 legacy route/outlet/session/visit/order audit
M2 backend-owned MCP writes and session snapshots
M3 customer onboarding bridge
M4 idempotent Sales Order adapter
M5 read-only Core order/fulfillment/delivery status
M6 Supabase/VPS adapter replacement and cutover
```

MCP frontend keeps working flows unless user testing proves a defect.

MCP migration/cutover remains in the infrastructure phase and requires backup/reconciliation.

---

## 14. Phase 7 — Advanced Inventory and Costing

```text
[ ] warehouse transfer with in-transit
[ ] partial receive/variance/damage
[ ] stocktake/recount/approval/posting
[ ] manual adjustments
[ ] quarantine/scrap
[ ] selected costing method
[ ] backdated/reversal costing rules
[ ] optional vehicle virtual location only if justified
```

Gate: every balance/costing value drills down to immutable movement/source documents.

---

## 15. Phase 8 — Reporting and Operations

```text
[ ] sales/purchase dashboards
[ ] inventory aging and nhập-xuất-tồn
[ ] stock availability
[ ] customer/supplier aging
[ ] gross margin after costing
[ ] employee/field-route performance
[ ] trip performance/on-time delivery
[ ] failed delivery reasons
[ ] vehicle/driver utilization
[ ] COD reconciliation when enabled
[ ] import/export history
[ ] audit/activity logs
```

Reports must be reproducible from source documents/ledgers/read models.

---

## 16. Phase 9 — MCP migration and infrastructure cutover

```text
[ ] Heroku apps and DB roles
[ ] Vercel projects/root directories
[ ] R2 buckets/lifecycle
[ ] MCP legacy data audit/export
[ ] canonical ID mapping
[ ] replace Supabase adapter
[ ] import and dual verification
[ ] backup and restore rehearsal
[ ] DNS/env switch
[ ] smoke and reconciliation
[ ] rollback/forward-fix runbook
```

Gate: MCP và Core chạy trên hạ tầng đích; Supabase/VPS không còn dependency production bắt buộc.

---

## 17. Test strategy

Mỗi vertical slice có tối thiểu:

```text
unit tests
repository/API contract tests
transaction and rollback tests
idempotency mismatch/replay tests
concurrency tests
permission/scope tests
migration apply/rerun tests
read-model reconciliation
frontend interaction tests
browser E2E
exact-head CI
production smoke riêng khi deploy
```

Case Phase 6 bắt buộc:

- unlinked outlet không tạo official Sales Order;
- link-existing không duplicate customer;
- MCP retry không duplicate Core order;
- invalid customer/address/SKU/unit bị chặn;
- concurrent reserve không oversell;
- one trip có nhiều Delivery Orders;
- one Delivery Order có nhiều attempts;
- partial delivery chỉ post số thực tế theo policy;
- failed delivery không completed order;
- reassignment có audit;
- return tham chiếu origin;
- COD không bypass accounting allocation;
- MCP không ghi trực tiếp Core tables.

---

## 18. Definition of Ready

Một slice chỉ code mutation khi đã khóa:

```text
source of truth
entity ownership
status/transitions
quantity/money/unit/rounding
posting points
permission and scope
canonical API
idempotency/concurrency
migration/forward-fix
acceptance tests
production boundary
```

---

## 19. Definition of Done

Một source slice hoàn thành khi:

```text
clean migration apply/rerun
transaction and rollback correct
frontend does not bypass backend
deny-by-default
audit/outbox complete
regression and E2E pass
exact-head CI green
documentation updated
merged to main
```

Production Done là gate riêng, chỉ khi deploy/migration/smoke/reconciliation/backup evidence đã được xác nhận.

---

## 20. Business decisions still open

Owner phải khóa trước transition liên quan:

```text
costing method
negative-stock exceptions if any
lot/expiry and FEFO policy
inventory issue point for Sales
receivable posting point
payable/receivable invoice policy
price includes VAT or excludes VAT
quantity/money/tax rounding
approval thresholds
credit override
backdated documents
failed-delivery stock treatment
COD handover/allocation
POD requirement
vehicle capacity enforcement
retention for files/logs
```

Lập trình viên không tự đoán.

---

## 21. Current execution checkpoint

```text
Source baseline: main@6983844b9f6b4a63ad0fe04863f1492e360050cb
Phases 1–5: source foundations available/closed as described above
Next phase: Phase 6A documentation and owner decision gate
MCP strategy: adapt and integrate existing app, do not rebuild
Production status: must be audited separately before any rollout claim
```

Thứ tự tiếp theo:

1. Merge Master Plan và Phase 6 decision documents.
2. Owner khóa các business decisions Phase 6A.
3. Audit fresh `main`, PRs, CI, migration registry và handoff.
4. Mở Sales Order Foundation branch.
5. Không bắt đầu Dispatch trước Delivery Order/Fulfillment foundation.
6. Không bắt đầu MCP official order write trước customer linking và idempotency contract.

---

## 22. Kết luận kiến trúc

```text
Một repo tổng.
Hai frontend.
Hai backend.
Một PostgreSQL installation, tách schema và quyền.
MCP là app field hiện hữu được thích nghi và tích hợp.
Core sở hữu customer chính thức, chứng từ, ledger và logistics.
Field outlet không mặc định là Core customer.
Sales Order, Delivery Order và Delivery Trip là các nguồn sự thật tách biệt.
Vehicle/trip không mặc định là warehouse.
Không sửa tồn/công nợ trực tiếp.
Không chắp vá lỗi.
Không code mutation trước domain contract.
Source merge và production rollout luôn báo cáo tách biệt.
```
