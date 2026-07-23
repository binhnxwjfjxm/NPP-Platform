# NPP Platform — Master Implementation Plan

> Trạng thái: **ACTIVE MASTER PLAN**  
> Phạm vi: **Toàn bộ nền tảng MCP + NPP Core**  
> Repo: `binhnxwjfjxm/NPP-Platform`  
> Áp dụng từ: `2026-07-23`  
> Nguyên tắc: **Không chắp vá khi lỗi; phải tái hiện, tìm nguyên nhân gốc, sửa đúng tầng và thêm test hồi quy.**

---

## 0. Quyền ưu tiên của tài liệu

Tài liệu này là master plan mới của repo `NPP-Platform`.

Nó thay thế vai trò master của:

- `mcp/ke-hoach-app-van-hanh-npp.md`;
- `mcp/ke-hoach-app-npp-moi-giu-logic-cu-lam-moi-frontend.md`;
- các plan module cũ trong `mcp/docs/npp-plan/` khi có điểm mâu thuẫn về kiến trúc, hạ tầng hoặc thứ tự triển khai.

Các tài liệu cũ vẫn được giữ làm tài liệu nghiệp vụ và lịch sử quyết định. Những nguyên tắc đúng về domain, transaction, idempotency, audit, trạng thái độc lập và ledger tiếp tục được kế thừa.

---

## 1. Mục tiêu sản phẩm

Xây dựng một nền tảng quản lý Nhà phân phối hoàn chỉnh gồm hai ứng dụng người dùng độc lập nhưng dùng chung chuẩn định danh, xác thực, hợp đồng API và dữ liệu nền.

```text
NPP Platform
├── MCP Field
│   ├── Tuyến bán hàng
│   ├── Phiên làm việc ngoài thị trường
│   ├── Check-in/GPS/hình ảnh
│   ├── Test sản phẩm
│   ├── Báo cáo thị trường
│   ├── Follow-up
│   └── Đề nghị/tạo đơn từ thị trường
│
└── NPP Core
    ├── Khách hàng và nhà cung cấp
    ├── Sản phẩm/SKU/đơn vị/bảng giá
    ├── Mua hàng và nhập hàng
    ├── Bán hàng và giao hàng
    ├── Kho đa kho
    ├── Kiểm kho/chuyển kho/điều chỉnh
    ├── Trả hàng hai chiều
    ├── Phải thu/phải trả/thu chi
    ├── Giá vốn
    ├── Báo cáo điều hành
    └── Người dùng/phân quyền/audit
```

MCP là ứng dụng tác nghiệp ngoài thị trường. NPP Core là hệ thống sở hữu nghiệp vụ kho, bán hàng, mua hàng và công nợ chính thức.

---

## 2. Các quyết định đã khóa

### 2.1 Một repo tổng, một Git

```text
NPP-Platform/
├── .git/
├── .github/
├── mcp/
├── npp-core/
├── packages/
├── database/
└── NPP_PLATFORM_MASTER_PLAN.md
```

- Chỉ có một `.git` tại root `NPP-Platform`.
- `mcp` và `npp-core` không có Git riêng.
- Không chuyển ngược toàn bộ MCP về root.
- Không tiếp tục đổi cấu trúc thư mục khi chưa có lý do kỹ thuật và migration path rõ ràng.

### 2.2 Hai ứng dụng frontend

```text
mcp/web hoặc code MCP hiện tại
npp-core/web
```

- MCP ưu tiên mobile/PWA, GPS, camera, thao tác nhanh, offline có kiểm soát.
- NPP Core ưu tiên desktop/web, bảng dữ liệu dày, lọc, đối soát, Excel, PDF và in chứng từ.
- Không ép hai UX khác nhau vào một AppShell duy nhất.

### 2.3 Hai backend service

```text
MCP API
NPP Core API
```

- Hai backend có quyền sở hữu domain khác nhau.
- Không backend nào được ghi trực tiếp vào bảng thuộc domain của backend còn lại.
- Giao tiếp qua canonical API và event/outbox có idempotency.
- Hai backend vẫn nằm trong cùng monorepo để chia sẻ contracts, types, test helpers và CI.

### 2.4 Một PostgreSQL cho installation hiện tại

Một PostgreSQL cluster, tách schema theo domain:

```text
shared
mcp
sales
purchasing
inventory
accounting
reporting
```

- Một database không có nghĩa là mọi service được ghi mọi bảng.
- Quyền DB phải giới hạn theo service role/schema.
- Không dùng `tenant_id` chắp vá trên mọi bảng trong phase hiện tại.
- Mỗi installation NPP vẫn có runtime, secret, database và storage riêng khi triển khai cho đơn vị khác.

### 2.5 Hạ tầng mục tiêu

```text
Vercel
├── MCP frontend
└── NPP Core frontend

Heroku
├── MCP backend
├── NPP Core backend
└── Heroku PostgreSQL Essential-1 10GB

Cloudflare R2
├── Ảnh điểm bán
├── Ảnh giao nhận
├── PDF
├── Excel
├── File import/export
└── File backup ngoài DB
```

Supabase và VPS hiện tại là hạ tầng nguồn của MCP cũ, không phải kiến trúc đích của NPP Platform.

### 2.6 Local ports

```text
MCP web       : 3002
NPP Core web  : 3003
NPP Core API  : 3004
MCP API       : 3102 hoặc port cấu hình riêng
```

Không chiếm port `3000` trong quy ước local của dự án này.

---

## 3. Đối chiếu với master plan cũ

### 3.1 Nội dung được giữ nguyên

1. Backend sở hữu logic nghiệp vụ quan trọng.
2. Frontend không mutation trực tiếp database.
3. Mỗi thay đổi schema phải có migration trong repo.
4. Mutation có nguy cơ retry phải idempotent.
5. Chứng từ đã post không sửa/xóa; sai dùng reversal hoặc adjustment.
6. Inventory ledger là nguồn sự thật tồn kho.
7. Receivable ledger là nguồn sự thật phải thu.
8. Tách `order_status`, `fulfillment_status`, `payment_status`.
9. Audit phải có actor, thời gian, request ID, source và before/after phù hợp.
10. Triển khai theo vertical slice: migration → backend → UI → test → deploy → smoke.
11. Không hardcode tên NPP, URL, IP, project ID hoặc secret trong business logic.
12. DB sạch phải dựng được từ migration + bootstrap/seed.

### 3.2 Nội dung được thay đổi

| Master cũ | Master mới |
|---|---|
| MCP-Plan là một app NPP duy nhất | NPP Platform có hai app: MCP Field và NPP Core |
| MCP nằm chung AppShell với các module Core | MCP và Core có frontend riêng |
| Một backend hiện hữu mở rộng dần | Hai backend có domain ownership rõ ràng |
| Supabase/VPS là runtime chính | Mục tiêu Vercel + Heroku + PostgreSQL + R2 |
| Module mua hàng để “tương lai” | Mua hàng, nhà cung cấp và phải trả là domain bắt buộc |
| Tập trung đơn hàng trước toàn bộ kho | Khóa master data và inventory ledger trước khi post nghiệp vụ thật |
| Chỉ nhấn mạnh phải thu | Bổ sung phải trả, thanh toán nhà cung cấp và đối soát hai chiều |
| Chưa khóa mô hình đa kho đầy đủ | Đa kho, in-transit, partial receipt và variance là first-class |
| Không có ranh giới MCP → Core đủ chặt | MCP chỉ đề nghị/tạo yêu cầu; Core xác nhận và post kho/công nợ |

### 3.3 Nội dung được bổ sung

- Nhà cung cấp, đơn mua, nhập hàng và trả nhà cung cấp.
- Phải trả và thanh toán nhà cung cấp.
- Giá vốn và phương pháp tính giá vốn.
- Kho đa kho, vị trí kho và hàng đi đường.
- Chênh lệch chuyển kho, hư hỏng và thiếu nhận.
- Kiểm kho theo scope và approval.
- Import/export job history.
- Backup, restore rehearsal và retention.
- Hai backend với service-specific DB roles.
- Outbox/event contract giữa MCP và Core.
- Kế hoạch chuyển Supabase REST/RPC sang direct PostgreSQL.

---
## 4. Cấu trúc repo mục tiêu

### 4.1 Giai đoạn hiện tại

Không di chuyển MCP thêm lần nữa ngay lập tức.

```text
NPP-Platform/
├── .github/
├── mcp/
│   ├── src/
│   ├── apps/backend/
│   ├── test/
│   ├── scripts/
│   ├── supabase/
│   └── package.json
│
├── npp-core/
│   ├── web/
│   ├── api/
│   ├── docs/
│   └── README.md
│
├── packages/
│   ├── contracts/
│   ├── domain-types/
│   ├── shared-utils/
│   ├── auth-context/
│   └── test-helpers/
│
└── database/
    ├── migrations/
    │   ├── shared/
    │   ├── mcp/
    │   ├── sales/
    │   ├── purchasing/
    │   ├── inventory/
    │   ├── accounting/
    │   └── reporting/
    ├── seeds/
    └── rehearsals/
```

### 4.2 Giai đoạn chuẩn hóa sau

Chỉ làm khi MCP build/test/deploy đã ổn định ở vị trí mới:

```text
apps/
├── mcp-web/
├── mcp-api/
├── core-web/
└── core-api/
```

Không thực hiện đồng thời ba việc sau trong một commit:

- di chuyển path lớn;
- đổi Supabase sang PostgreSQL trực tiếp;
- xây domain tồn kho.

---

## 5. Ranh giới domain và quyền sở hữu

### Shared domain

```text
installations/config
users
roles
permissions
employees
warehouses
customers
suppliers
products
variants/SKU
units/conversions
price lists
number sequences
audit metadata
```

### MCP domain

```text
routes
route customers
route sessions
session customers
visits/check-in
field tests
market reports
follow-ups
field media
MCP action logs
```

MCP không sở hữu:

```text
inventory balances
inventory movements
official receivables
official payables
posted goods receipts
posted deliveries
costing entries
```

### Sales domain

```text
sales orders
order items
order versions/amendments
allocations/fulfillments
deliveries
customer returns
exchanges
sales credit/debit adjustments
```

### Purchasing domain

```text
purchase orders
purchase order items
goods receipts
receipt items
supplier returns
purchase adjustments
supplier invoices/reference documents
```

### Inventory domain

```text
inventory ledger
inventory movements
movement lines
reservations
balances/read models
lots/expiry
stocktakes
adjustments
warehouse transfers
in-transit stock
quarantine/scrap
```

### Accounting operations domain

Phase đầu không xây kế toán tổng hợp đầy đủ. Core phải sở hữu tối thiểu:

```text
receivables
payments received
payment allocations
payables
supplier payments
supplier payment allocations
credit/debit notes
refunds
overpayments
write-offs
cash/bank references
costing entries
```

---

## 6. Nguồn sự thật bắt buộc

```text
Khách đặt gì                    -> sales order
Nhà phân phối đặt mua gì        -> purchase order
Thực tế nhận từ nhà cung cấp    -> goods receipt
Thực tế giao khách              -> delivery
Tồn kho                         -> inventory ledger
Tồn tổng hợp                    -> rebuildable balance/read model
Khách còn nợ                    -> receivable ledger
NPP còn nợ nhà cung cấp         -> payable ledger
Đã thu/đã chi                   -> payment + allocation
Giá vốn                         -> costing entries dựa trên movement
Ai làm gì                       -> audit/event log
```

Cấm:

- sửa trực tiếp `stock_quantity`;
- cộng trừ trực tiếp `customer.debt` hoặc `supplier.debt`;
- ghi `paid=true` thay cho payment allocation;
- xóa chứng từ đã post;
- dùng một status đại diện đồng thời cho đặt hàng, kho, giao và tiền.

---

## 7. Master data bắt buộc

### Tổ chức và cấu hình

```text
installation
company/distributor profile
branches
warehouses
warehouse locations
currency/timezone
business calendar
number sequences
approval policies
negative-stock policy
costing policy
lot/expiry policy
```

### Khách hàng

```text
customer code
name
contacts
addresses
channel/group
sales owner
route assignment
credit profile
payment terms
status
notes/tags
```

Khách MCP và khách Core phải dùng cùng canonical customer ID.

### Nhà cung cấp

```text
supplier code
name
contacts
addresses
payment terms
bank/tax references
lead time
purchase owner
status
```

### Sản phẩm, SKU và đơn vị

```text
product
variant/SKU
category
brand
base inventory unit
sales units
purchase units
unit conversions
barcode theo SKU/đơn vị
lot/expiry flags
price lists
purchase price references
status
```

Quy tắc:

- Base inventory unit bất biến sau movement đầu tiên, trừ migration có kiểm soát.
- Dùng decimal chính xác, không dùng float cho quantity/money.
- Chứng từ lưu snapshot tên, SKU, unit, conversion, giá và thuế tại thời điểm xác nhận/post.
- Không hard-delete SKU đã phát sinh nghiệp vụ.

---

## 8. Kho đa kho

### Các bucket tồn

Theo warehouse + location + SKU + lot khi có:

```text
on_hand
reserved
available
blocked
quarantine
in_transit
```

```text
available = on_hand - reserved - blocked - quarantine
```

Công thức thực tế phải khóa bằng policy và test.

### Movement tối thiểu

```text
opening
purchase_receipt
purchase_return
sales_reservation
reservation_release
sales_issue
customer_return_sellable
customer_return_quarantine
transfer_out
transfer_in
stocktake_variance_in
stocktake_variance_out
adjustment_in
adjustment_out
scrap
reversal
```

### Chuyển kho

```text
draft
-> approved
-> picked
-> shipped/transfer_out
-> in_transit
-> partially_received hoặc received/transfer_in
-> variance resolved
-> completed
```

Bắt buộc hỗ trợ nhận một phần, thiếu/dư, hư hỏng, sai SKU/lô, từ chối nhận và chứng từ xử lý chênh lệch.

### Kiểm kho

```text
create scope
-> count
-> recount khi cần
-> review variance
-> approve
-> post movement
-> close
```

Không sửa balance trực tiếp sau kiểm đếm.

### Âm kho

Mặc định: **không cho âm kho**.

Ngoại lệ phải có policy, quyền, reason code, approval, audit và báo cáo riêng.

---

## 9. Mua hàng và phải trả

### Vòng đời mua hàng

```text
Purchase request nếu dùng
-> Purchase order draft
-> approved/confirmed
-> supplier shipment reference
-> goods receipt một hoặc nhiều lần
-> quality/quantity variance
-> inventory receipt post
-> payable post
-> supplier payment/allocation
-> completed/cancelled
```

### Nhận hàng

Mỗi dòng nhận phải ghi:

```text
ordered quantity
previously received
received now
accepted quantity
rejected quantity
shortage/excess
warehouse/location
lot
manufacturing date
expiry date
unit/conversion snapshot
purchase cost components
```

### Trả hàng nhà cung cấp

```text
return request
-> approve
-> pick from sellable/quarantine
-> issue supplier return
-> supplier credit/debit adjustment
-> payable offset hoặc refund
```

Không giảm phải trả hoặc tăng tồn chỉ vì tạo yêu cầu trả.

### Phải trả

```text
payable documents
payable transactions
supplier payments
supplier payment allocations
supplier credits/debits
reversals
```

Một payment có thể phân bổ nhiều chứng từ và một chứng từ có thể được nhiều payment.

---
## 10. Bán hàng, giao hàng và phải thu

### Nguồn đơn

```text
manual core
MCP field
import
API
sales rep
```

Đơn từ MCP phải có:

```text
source_type
source_id
idempotency_key
actor/request_id
canonical customer ID
canonical SKU/unit ID
```

Retry cùng key trả lại cùng kết quả, không tạo duplicate.

### Các trục trạng thái

```text
order_status:
  draft | confirmed | cancelled | completed

fulfillment_status:
  unfulfilled | allocated | picking | packed
  | partially_delivered | delivered | returned

payment_status:
  unposted | unpaid | partially_paid | paid
  | overpaid | refunded | written_off

delivery_status:
  planned | dispatched | partially_received
  | accepted | rejected | failed | returned
```

Các status tổng hợp phải được tính từ chứng từ con.

### Giao một phần và backorder

- Một order có nhiều fulfillment và delivery.
- Chỉ issue đúng số thực xuất.
- Phần còn lại phải chọn rõ: backorder, dời lịch, amendment hoặc hủy phần còn lại.
- Không tự coi giao thiếu là completed.

### Trả hàng khách

```text
request
-> receive/inspect
-> classify sellable/quarantine/scrap
-> post inventory movement
-> credit receivable/refund/offset
-> close
```

Return phải tham chiếu delivery/order item gốc khi có thể.

### Phải thu

```text
receivable documents
receivable transactions
payments received
payment allocations
credits/debits
refunds
write-offs
reversals
```

Aging dựa trên due date và remaining amount.

---

## 11. Giá vốn

Phải chốt một phương pháp trước khi post movement production:

```text
moving weighted average
hoặc FIFO theo lot/movement
```

Phase đầu chỉ dùng một phương pháp.

Giá vốn phải xử lý:

- chi phí mua;
- chi phí phân bổ nếu áp dụng;
- nhập trả khách;
- trả nhà cung cấp;
- chuyển kho;
- điều chỉnh tăng/giảm;
- tồn âm nếu policy đặc biệt;
- reversal và backdated posting.

Không tính lợi nhuận bằng giá bán trừ “giá nhập hiện tại”.

---

## 12. MCP tích hợp NPP Core

### Luồng tạo đơn

```text
MCP Field
-> thu thập khách/SKU/số lượng/ghi chú
-> gọi Core API tạo order request/draft
-> Core kiểm tra customer, price, unit, credit và stock policy
-> Core trả order ID + trạng thái
-> MCP lưu reference và hiển thị kết quả
```

MCP không tự reserve tồn, issue kho, ghi phải thu, gán paid/delivered hoặc tạo SKU bằng text tự do.

### Luồng master data

MCP đọc catalog rút gọn từ Core API/read model:

```text
customers assigned to employee/route
active products/SKU
sales units
resolved prices
available stock theo quyền hiển thị
credit warning theo policy
```

### Event/outbox

```text
core.order.created
core.order.confirmed
core.order.cancelled
core.delivery.posted
core.payment.received
core.customer.updated
core.product.updated
mcp.visit.completed
mcp.test.recorded
mcp.market_report.created
```

Event phải có event ID, aggregate ID, version, occurredAt và idempotency handling.

---

## 13. API contract

Success:

```json
{
  "data": {},
  "requestId": "req_...",
  "receivedAt": "2026-07-23T00:00:00.000Z"
}
```

Error:

```json
{
  "error": {
    "code": "INSUFFICIENT_AVAILABLE_STOCK",
    "message": "Tồn khả dụng không đủ.",
    "details": {},
    "retryable": false
  },
  "requestId": "req_...",
  "receivedAt": "2026-07-23T00:00:00.000Z"
}
```

Cấm trả public raw DB/provider error, tên bảng/cột/RPC, stack trace, secret hoặc row chưa qua mapper.

---

## 14. Authentication, authorization và audit

### Request context

```text
installationId từ server config
actorId
employeeId nếu có
roles
permissions
warehouse/branch/territory scope
requestId
idempotencyKey khi có mutation
```

Không tin installation, role hoặc warehouse scope gửi tự do trong body client.

### Quyền tối thiểu

```text
owner/admin
sales manager
sales rep
warehouse manager
warehouse operator
purchasing
accounting/receivable
accounting/payable
viewer/auditor
```

Quyền riêng cho sửa giá, âm kho, adjustment, stocktake posting, transfer approval, credit override, payment reversal, refund/write-off và export nhạy cảm.

### Audit

```text
actor
request ID
source app/service
operation
entity/document
before/after hoặc diff
reason code/note
occurredAt
IP/device metadata khi cần
```

---

## 15. Kế hoạch dữ liệu và migration

### Nguyên tắc

- Không sửa production DB thủ công mà không có migration.
- Migration phải chạy được trên DB sạch.
- Data migration phải idempotent hoặc có checkpoint.
- Backfill có đối soát trước/sau.
- Không xóa nguồn Supabase cũ trước cutover và backup/restore.

### Chuyển MCP sang PostgreSQL mới

Dữ liệu MCP hiện nhỏ nên volume migration không phải vấn đề chính. Công việc chính là đổi tầng truy cập dữ liệu.

```text
Supabase REST/RPC adapter hiện tại
-> repository ports
-> PostgreSQL adapter trực tiếp
-> repository contract tests
-> data export/import
-> dual verification
-> cutover
-> smoke
```

Không thay mọi call bằng SQL rải trong controller.

### Thứ tự schema

```text
1. shared
2. mcp
3. inventory foundation
4. sales
5. purchasing
6. accounting
7. reporting/read models
```

---
## 16. Lộ trình triển khai

### Phase 0 — Khóa baseline repo

```text
[ ] MCP dev chạy tại port 3002
[ ] MCP build pass
[ ] MCP verify:foundation pass
[ ] Test Windows path dùng fileURLToPath
[ ] Root .gitignore bảo vệ cả mcp và npp-core
[ ] npp-core có README/file giữ thư mục
[ ] GitHub Actions cập nhật working-directory/root path
[ ] Vercel Root Directory của MCP trỏ vào mcp
[ ] Deploy scripts/VPS paths được audit trước khi dùng lại
```

Gate: không code Core khi baseline MCP chưa xanh, trừ skeleton không ảnh hưởng MCP.

### Phase 1 — Monorepo foundation

```text
[ ] Root workspace/package manager strategy
[ ] packages/contracts
[ ] packages/domain-types
[ ] packages/shared-utils
[ ] packages/auth-context
[ ] database/migrations structure
[ ] CI matrix cho mcp và npp-core
[ ] env templates tách từng app/service
[ ] local port convention
```

Gate: mỗi app build/test độc lập từ root command hoặc documented working directory.

### Phase 2 — Core API/Web skeleton

```text
[ ] npp-core/api health/config/error envelope
[ ] npp-core/web AppShell/login/layout
[ ] PostgreSQL connection pool
[ ] migration runner
[ ] request context
[ ] auth/permission middleware
[ ] idempotency store
[ ] audit/outbox foundation
[ ] object storage adapter R2
```

Gate: authenticated health + migration rehearsal + deny-by-default permission pass.

### Phase 3 — Master data

```text
[ ] installation/company config
[ ] branches/warehouses/locations
[ ] users/employees/roles/scopes
[ ] customers/customer groups/addresses
[ ] suppliers/supplier terms
[ ] products/SKU/categories/brands
[ ] units/conversions/barcodes
[ ] price lists and pricing resolve
[ ] document numbering
```

Gate: canonical IDs dùng được từ cả MCP và Core; unit conversion/pricing tests pass.

### Phase 4 — Inventory foundation

```text
[ ] inventory ledger
[ ] movement posting/reversal
[ ] balances/read model rebuild
[ ] reservations
[ ] negative-stock policy
[ ] lot/expiry foundation
[ ] opening balance import
[ ] movement drill-down UI
```

Gate: rebuild balances khớp ledger; concurrent reserve không oversell; retry không duplicate.

### Phase 5 — Purchasing

```text
[ ] purchase order
[ ] approval
[ ] partial goods receipt
[ ] receipt inventory posting
[ ] quantity/quality variance
[ ] supplier return
[ ] payable posting
[ ] supplier payment/allocation
```

Gate: PO → partial receipts → inventory → payable → payment chạy end-to-end.

### Phase 6 — Sales

```text
[ ] sales order draft/confirm/amend/cancel
[ ] price/discount/tax calculation
[ ] stock reservation/allocation
[ ] pick/pack/delivery
[ ] partial delivery/backorder
[ ] customer return/exchange
[ ] receivable posting
[ ] payment/allocation/refund
[ ] MCP create-order integration
```

Gate: MCP retry không duplicate; giao một phần chỉ trừ số thực xuất; return đảo kho/công nợ đúng.

### Phase 7 — Kho nâng cao và giá vốn

```text
[ ] warehouse transfer with in-transit
[ ] partial receive/variance/damage
[ ] stocktake/recount/approval/posting
[ ] adjustments
[ ] quarantine/scrap
[ ] costing method
[ ] backdated/reversal costing rules
```

Gate: mọi tồn và giá vốn drill-down được đến movement/source document.

### Phase 8 — Báo cáo và điều hành

```text
[ ] sales dashboard
[ ] purchase dashboard
[ ] inventory aging
[ ] nhập-xuất-tồn
[ ] stock availability
[ ] customer receivable aging
[ ] supplier payable aging
[ ] gross margin
[ ] employee/route performance
[ ] import/export history
[ ] activity/audit logs
```

Gate: báo cáo tái tạo được từ ledger/chứng từ và đối soát được với dữ liệu nguồn.

### Phase 9 — Migration và cutover hạ tầng

```text
[ ] Heroku apps
[ ] Heroku PostgreSQL schemas/roles
[ ] Vercel projects/root directories
[ ] R2 buckets/lifecycle
[ ] migrate MCP data
[ ] replace Supabase adapter
[ ] production rehearsal
[ ] backup before cutover
[ ] DNS/env switch
[ ] smoke and reconciliation
[ ] rollback/forward-fix runbook
```

Gate: cả MCP và Core chạy trên hạ tầng đích; Supabase/VPS không còn là dependency production bắt buộc.

---

## 17. Test strategy

Mỗi vertical slice phải có:

```text
unit tests
repository contract tests
API contract tests
transaction tests
idempotency tests
concurrency tests
permission tests
migration tests
read-model rebuild/reconciliation tests
frontend interaction tests
production smoke
```

Case bắt buộc:

- retry tạo đơn/nhập/xuất/thanh toán không duplicate;
- concurrent reserve không vượt available;
- chuyển kho giữ đúng in-transit;
- nhận chuyển kho một phần không tăng thừa;
- kiểm kho post bằng movement;
- return request chưa nhận không tăng tồn;
- payment chưa allocation vẫn còn nhìn thấy;
- reversal khôi phục ledger đúng;
- đổi unit/price/tên không làm đổi chứng từ lịch sử;
- quyền kho A không thao tác kho B;
- MCP không ghi trực tiếp Core tables.

---

## 18. Definition of Ready

Một slice chỉ code mutation khi đã khóa source of truth, ngoại lệ, status/transition, money/quantity/unit/rounding, permission, canonical API, migration/forward-fix, idempotency/concurrency và acceptance test.

---

## 19. Definition of Done

Một slice chỉ hoàn thành khi migration DB sạch, transaction đúng, frontend không bypass, deny-by-default, audit/outbox đủ, test pass, read model khớp, build/deploy/smoke pass và tài liệu được cập nhật.

---

## 20. Backup, restore và retention

### Ba lớp backup

```text
1. Heroku PostgreSQL backup/snapshot
2. Bản sao ngoài hệ thống trên R2
3. Bản tải local định kỳ
```

Backup chỉ được coi là dùng được sau restore rehearsal trên DB test và chạy đối soát/smoke.

Không xóa ledger/chứng từ để giảm dung lượng. Chỉ prune temp upload, export hết hạn, log kỹ thuật, payload tạm, cache/read model rebuild được và smoke fixtures.

---

## 21. Các quyết định phải khóa trước khi post nghiệp vụ thật

```text
[ ] Phương pháp giá vốn: moving average hay FIFO
[ ] Chính sách âm kho
[ ] Nhóm sản phẩm quản lý lot/expiry
[ ] Thời điểm post receivable
[ ] Thời điểm post payable
[ ] Giá có VAT hay chưa VAT
[ ] Quy tắc rounding quantity/money
[ ] Approval thresholds
[ ] Warehouse/location model thực tế
[ ] Hàng trên xe có là kho riêng không
[ ] Chuyển kho nội bộ tức thời có được phép không
[ ] Chính sách chứng từ backdated
[ ] Retention cho file/log
```

Đây là business decision, không được lập trình viên tự đoán.

---

## 22. Việc tiếp theo theo đúng thứ tự

```text
1. Hoàn tất Phase 0: MCP chạy/build/test sau khi chuyển vào /mcp.
2. Sửa root .gitignore, GitHub Actions, Vercel Root Directory và deploy path.
3. Tạo skeleton npp-core/web và npp-core/api.
4. Tạo packages/contracts + database/migrations.
5. Khóa money/quantity/unit và document numbering.
6. Làm shared master data.
7. Làm inventory ledger foundation.
8. Làm purchasing end-to-end.
9. Làm sales end-to-end và nối MCP.
10. Làm receivable/payable/costing/reporting.
11. Rehearsal migration MCP sang PostgreSQL mới.
12. Cutover hạ tầng sau khi reconciliation pass.
```

Không bắt đầu bằng việc dựng hàng loạt màn hình giống Sapo. UI chỉ triển khai sau khi source of truth, document lifecycle, ledger và API contract của slice đã được khóa.

---

## 23. Kết luận kiến trúc

```text
Một repo tổng.
Hai frontend.
Hai backend.
Một PostgreSQL installation, tách schema và quyền.
R2 giữ file lớn.
MCP sở hữu vận hành thị trường.
NPP Core sở hữu mua-bán-kho-công nợ-giá vốn.
Ledger và chứng từ là nguồn sự thật.
Không sửa tồn/công nợ trực tiếp.
Không chắp vá lỗi.
Không code UI trước domain contract.
```
