# MCP v1 — Canonical Execution Plan

> Trạng thái: **CORE COMPLETE / FROZEN**  
> Ngày khóa: **2026-07-12**  
> Tài liệu chi tiết: `docs/MCP_V1_FREEZE.md`  
> Phase kế tiếp: [`ke-hoach-app-van-hanh-npp.md`](./ke-hoach-app-van-hanh-npp.md)

Tài liệu này thay thế các checklist MCP cũ. Không dùng lại các mục `todo` hoặc contract cũ trước ngày freeze.

## 1. Kiến trúc bắt buộc

```text
Browser
  -> Next.js/Vercel proxy
  -> VPS backend 165.22.109.61
  -> Supabase bằng service role trên VPS
```

Runtime:

```text
Frontend: https://mcp-plan.vercel.app
VPS source: /var/www/mcp-plan-source
VPS runtime: /var/www/mcp-plan-backend
PM2 app: mcp-plan-backend
Internal backend: http://127.0.0.1:3001
Deploy backend: pullmcp
Supabase project: noiadkpkvdohljgopgfb
```

Nguyên tắc cố định:

1. Không đặt `SUPABASE_SERVICE_ROLE_KEY` trên Vercel hoặc browser.
2. Vercel chỉ render frontend và proxy request.
3. Mutation MCP chỉ chạy tại VPS backend.
4. VPS gọi Supabase bằng service role.
5. Không fallback mock/latest session khi đã có `routeId`, `sessionId`, `sessionCustomerId` hoặc ngày cụ thể.
6. Không trả thành công nếu DB không áp dụng mutation.

## 2. Contract phiên đã khóa

```text
mcp_routes
  -> route master

mcp_route_customers
  -> khách gốc của route

mcp_route_sessions
  -> một phiên theo route_id + session_date

mcp_session_customers
  -> snapshot khách trong phiên

mcp_visits
  -> kết quả ghé

mcp_followups
  -> việc theo dõi

mcp_session_reports
  -> snapshot báo cáo phiên
```

Quy tắc:

1. Unique `(route_id, session_date)`.
2. Mở lại cùng tuyến/ngày trả lại đúng session cũ.
3. Khách route master chỉ snapshot khi session vừa được tạo lần đầu.
4. Mở lại session không chèn khách mới từ route master, kể cả session ban đầu có 0 khách.
5. Snapshot không duplicate theo `(session_id, route_customer_id)`.
6. Visit dùng `session.session_date`, không dùng ngày hiện tại của server.
7. `done`, `completed`, `cancelled` là read-only cho checklist, visit và follow-up.
8. Chốt phiên tạo/upsert snapshot `mcp_session_reports`.
9. Phiên rỗng được xóa.
10. Phiên có visit/đơn/test/báo cáo/follow-up không được xóa; trả conflict.
11. Hard-delete route/khách chỉ chạy bằng RPC nội bộ có transaction-local bypass.

## 3. Contract nghiệp vụ đã khóa

### 3.1 Đơn hàng

Endpoint:

```text
POST /api/mcp-day/session-customer/order
```

Input chính:

```json
{
  "sessionCustomerId": "msc_...",
  "status": "confirmed",
  "note": "...",
  "items": [
    {
      "productId": "...",
      "variantId": "...",
      "productName": "...",
      "sku": "...",
      "unit": "...",
      "quantity": 1,
      "unitPrice": 0,
      "discount": 0,
      "note": "..."
    }
  ]
}
```

DB output:

```text
orders
order_items
mcp_visits.has_order / order_id
mcp_session_customers.order_id
mcp_route_sessions.order_count
```

Lưu ý phase App NPP:

- Endpoint MCP trên chỉ là **nguồn tạo đơn từ hoạt động thị trường**.
- Vòng đời sửa/hủy/giao thiếu/trả/đổi/kho/công nợ thuộc domain Đơn hàng App NPP.
- Không mở rộng âm thầm endpoint MCP để gánh toàn bộ order lifecycle.
- Thiết kế order lifecycle mới phải giữ tương thích source reference/idempotency với đơn từ MCP.

Plan order lifecycle: [`docs/npp-plan/03-don-hang.md`](./docs/npp-plan/03-don-hang.md).

### 3.2 Test sản phẩm

Endpoint:

```text
POST /api/mcp-day/session-customer/test
```

Trạng thái kết quả:

```text
pending | tested | ok | interested | sample | follow | bad | retry
```

DB output:

```text
test_files
test_customers
test_customer_results
mcp_visits.has_test / test_id
mcp_session_customers.test_id
mcp_route_sessions.test_count
```

### 3.3 Báo cáo thị trường

Endpoint:

```text
POST /api/mcp-day/session-customer/report
```

Report type:

```text
market_report | price | competitor | display | stock | demand | general
```

Payload giữ nguyên `fields`, `selected`, `context` và nội dung báo cáo.

DB output:

```text
market_reports
mcp_visits.has_report / report_id
mcp_session_customers.report_id
mcp_route_sessions.report_count
```

### 3.4 Follow-up

Endpoint:

```text
POST /api/mcp-day/session-customer/followup
```

Input gồm:

```text
title
dueDate
owner
priority: low | medium | high | urgent
followupType
note
```

DB output:

```text
mcp_followups
mcp_session_customers.followup_count
mcp_route_sessions.followup_count
```

## 4. Mutation API qua VPS

```text
POST   /api/mcp-day/open-session
POST   /api/mcp-day/session-customer/status
POST   /api/mcp-day/session-customer/order
POST   /api/mcp-day/session-customer/test
POST   /api/mcp-day/session-customer/report
POST   /api/mcp-day/session-customer/followup
POST   /api/mcp-session-report
POST   /api/mcp-session-report/ai-result
PATCH  /api/mcp-sessions/:id
DELETE /api/mcp-sessions/:id

POST   /api/routes
PATCH  /api/routes/:id
POST   /api/routes/:id/archive
POST   /api/route-customers
PATCH  /api/route-customers/:id
POST   /api/route-customers/:id/archive

POST   /api/mcp-report-settings
PATCH  /api/mcp-report-settings

POST   /api/mcp-settings/order-template
POST   /api/mcp-settings/test-template
POST   /api/mcp-settings/report-template
POST   /api/mcp-settings/followup-template
POST   /api/mcp-settings/skip-reason-template
POST   /api/mcp-settings/customer-add-rule
POST   /api/mcp-settings/session-status
```

Read API có thể đi qua VPS hoặc route server phù hợp, nhưng không được mở lại đường mutation trực tiếp tại Vercel.

## 5. Khóa DB

Các bảng `public.mcp_*`:

```text
PUBLIC / anon / authenticated:
- không INSERT
- không UPDATE
- không DELETE
- không TRUNCATE
- không REFERENCES
- không TRIGGER

service_role:
- đường mutation duy nhất
```

Đã gỡ toàn bộ RLS policy ghi trên bảng `mcp_*`.

Đã thu hồi quyền gọi trực tiếp cho `anon/authenticated` đối với:

```text
create / update / set / delete / open
backfill / import / save / recalc
assert / block / sync / upsert
trigger/helper mutation functions
```

Read-only RPC có chủ đích vẫn giữ theo contract đọc.

Migration khóa cuối:

```text
20260712025937_freeze_mcp_v1_contract_20260711.sql
20260712025959_fix_mcp_v1_session_update_order_20260711.sql
20260712030259_allow_internal_mcp_hard_delete_cleanup_20260711.sql
20260712030333_use_internal_flag_for_mcp_hard_delete_20260712.sql
20260712033916_fix_mcp_open_session_snapshot_once_20260712.sql
20260712034606_lock_mcp_v1_database_mutation_boundary_20260712.sql
```

## 6. Error contract

```text
400: payload thiếu hoặc giá trị không hợp lệ
404: route/session/session customer không tồn tại
409: phiên đã khóa, phiên có hoạt động hoặc conflict nghiệp vụ
500: lỗi backend/DB
502/503: VPS, upstream hoặc cấu hình runtime lỗi
```

## 7. Kết quả kiểm thử freeze

Boundary audit:

```text
32 MCP-relevant Next API files
PASS: không còn mutation trực tiếp từ Next.js/Vercel vào Supabase
```

Production DB service-role smoke:

```text
✅ mở lần đầu created=true
✅ mở lần hai created=false
✅ cùng session, không duplicate
✅ snapshot khách chỉ chạy một lần
✅ session mở lúc 0 khách vẫn giữ snapshot 0 khi route master thêm khách
✅ visit ghi đúng session_date
✅ tạo đơn + order item thật
✅ tạo test result thật
✅ tạo market report thật
✅ tạo follow-up thật
✅ counter đơn/test/report/follow-up đúng
✅ xóa session có hoạt động bị chặn
✅ close trả done và tạo snapshot
✅ mutation sau close bị chặn
✅ direct DELETE child row sau close bị chặn
✅ empty cancelled session xóa được
✅ hard-delete nội bộ dọn được dữ liệu đã khóa
✅ anon bị chặn ghi bảng trực tiếp
✅ anon bị chặn gọi RPC mutation
✅ không còn dữ liệu smoke
```

Build/deploy frontend:

```text
✅ backend syntax check
✅ npm build
✅ Vercel preview
✅ Vercel production main
```

Post-deploy API smoke:

```bash
cd /var/www/mcp-plan-source
MCP_API_BASE_URL=http://127.0.0.1:3001 node scripts/smoke-mcp-v1-api.mjs
```

## 8. Quy trình triển khai release MCP v1

Local:

```powershell
cd "F:\1_A_Disk_D\Tool\mcp-plan"
git pull origin main
npm run build
```

VPS:

```bash
pullmcp
pm2 status
pm2 logs mcp-plan-backend --lines 100
curl -fsS http://127.0.0.1:3001/api/health
cd /var/www/mcp-plan-source
MCP_API_BASE_URL=http://127.0.0.1:3001 node scripts/smoke-mcp-v1-api.mjs
```

Không sửa code trực tiếp trong `/var/www/mcp-plan-backend`.

## 9. Trạng thái sau khi đóng phase MCP

Tuyên bố chính thức:

```text
Đóng phase phát triển lõi MCP.
Không đóng module MCP.
MCP v1 tiếp tục vận hành như phân hệ thị trường trong App NPP.
```

MCP v1 từ đây chỉ nhận các loại thay đổi:

1. Sửa lỗi thật có bước tái hiện và test hồi quy.
2. Tối ưu hiệu năng không làm đổi contract nghiệp vụ.
3. Hardening bảo mật không phá đường vận hành đã khóa.
4. Nâng cấp có migration, version contract và smoke test rõ ràng.
5. Adapter/integration sang App NPP nhưng không mutate lịch sử/snapshot MCP sai contract.

Không được:

- thêm trạng thái/field rồi dùng ngầm không cập nhật contract;
- đổi logic snapshot vì nhu cầu một màn hình mới;
- dùng bảng MCP làm nơi chứa toàn bộ dữ liệu App NPP;
- mở lại mutation trực tiếp từ Vercel/browser;
- sửa dữ liệu production thủ công thay cho migration/backfill có kiểm soát;
- biến endpoint tạo đơn MCP thành toàn bộ vòng đời đơn hàng;
- ghi đè follow-up/report/session lịch sử để phục vụ plan/report mới.

## 10. Handoff sang App NPP tổng thể

Master plan:

[`ke-hoach-app-van-hanh-npp.md`](./ke-hoach-app-van-hanh-npp.md)

Các module độc lập:

```text
NPP-00 Tổng quan điều hành
NPP-01 Khách hàng
NPP-02 Sản phẩm
NPP-03 Đơn hàng
NPP-04 Tồn kho
NPP-05 Công nợ
NPP-06 Nhân viên
NPP-07 Kế hoạch
NPP-08 Báo cáo
NPP-09 Cài đặt và phân quyền
```

Thứ tự menu/nghiệp vụ:

```text
Tổng quan điều hành -> Khách hàng -> Sản phẩm -> Đơn hàng
-> Tồn kho -> Công nợ -> Nhân viên -> Kế hoạch
-> Báo cáo -> Cài đặt và phân quyền
```

Thứ tự triển khai kỹ thuật phải theo phụ thuộc, không làm frontend trước contract:

```text
Permission/audit foundation
-> Customer/Product master tối thiểu
-> Order lifecycle
-> Inventory/Fulfillment
-> Receivables/Payment
-> Dashboard/Employee/Plan/Report
-> Settings/permission hoàn chỉnh
```

## 11. Change control khi buộc phải thay MCP core

Khi cần thay core MCP v1:

1. Tạo issue/decision log ghi rõ lỗi hoặc nhu cầu nghiệp vụ.
2. Xác định đây là bug fix tương thích hay contract v2.
3. Audit dữ liệu production bị ảnh hưởng.
4. Tạo migration mới; không sửa migration đã chạy.
5. Version contract mới nếu behavior/output thay đổi.
6. Cập nhật backend, proxy và consumer liên quan.
7. Thêm unit/integration/idempotency/permission test tương ứng.
8. Chạy lại full MCP v1 smoke và test mới.
9. Có deploy/rollback hoặc forward-fix plan.
10. Cập nhật tài liệu freeze và master App NPP.
11. Không sửa âm thầm contract đã freeze.

## 12. Phạm vi mở rộng không được nhập nhằng với MCP core

Các miền sau thuộc App NPP hoặc module mở rộng, không tự động trở thành MCP core:

```text
Warehouse/Inventory
Transport/Fulfillment
Accounting/Receivables
Customer master mở rộng
Product/Pricing master
Order amendment/cancel/partial delivery/return/exchange
Employee/permission
Dashboard/report mở rộng
AI/ADK trên snapshot/read model
Offline/mobile queue
Template nâng cao ngoài core hiện tại
```

Mọi miền trên phải theo plan riêng, migration riêng và contract riêng. MCP chỉ cung cấp source/context cần thiết qua integration đã định nghĩa.
