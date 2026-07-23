# A5.4.3 — Audit quyền ghi Report Settings

> Trạng thái: **AUDITED — IMPLEMENTATION NOT STARTED**  
> Ngày audit: **2026-07-16**  
> Phạm vi: `mcp_setting_groups` và `mcp_setting_items`  
> Baseline direct REST mutation debt: **7**  
> Mục tiêu sau implementation: **3**

## 1. Kết luận ngắn

A5.4.3 có đúng **4 mutation live** cần retire. Không có mutation nào trong bốn đường này là dead code.

```text
POST  /api/mcp-report-setting-groups  create group
PATCH /api/mcp-report-setting-groups  update/toggle group
POST  /api/mcp-report-settings        create item
PATCH /api/mcp-report-settings        update/toggle item
```

Quyền ghi hiện bị chia đôi:

```text
group writes -> Foundation transitional handler -> direct PostgREST
item writes  -> Foundation Gateway passthrough -> legacy backend -> direct PostgREST
```

Đích đúng là một application owner tại Foundation, gọi các RPC service-role-only. Không giữ generic direct-table settings endpoint và không giữ legacy fallback.

## 2. Caller inventory

### 2.1 Group management UI — live

File:

```text
src/app/mcp-setting/groups/page.tsx
```

Luồng đang dùng:

```text
load groups
GET /api/mcp-report-settings?groupType=market_report&includeInactive=1

create group
POST /api/mcp-report-setting-groups

edit group / toggle active
PATCH /api/mcp-report-setting-groups
```

Màn hình này có thao tác thêm, sửa và bật/tắt nhóm nên cả POST và PATCH đều reachable.

Next route:

```text
src/app/api/mcp-report-setting-groups/route.ts
-> proxyBackendRequest(..., /api/mcp-report-setting-groups)
```

Next/Vercel không còn ghi trực tiếp Supabase ở route này. Việc chuyển sang proxy đã có từ commit `640732e353b04f08f2e2a8ea473c3d65851405fe`.

### 2.2 Item management UI — live

File:

```text
src/features/mcp-settings/McpReportSettingsPage.tsx
```

Luồng đang dùng:

```text
load groups/items
GET /api/mcp-report-settings?groupType=market_report&includeInactive=1

create item
POST /api/mcp-report-settings

edit item / toggle active
PATCH /api/mcp-report-settings
```

Màn hình này tạo item mới, cập nhật item và bật/tắt trạng thái nên cả POST và PATCH đều reachable.

Next routes:

```text
src/app/api/mcp-report-settings/route.ts
-> re-export src/app/api/backend/mcp-report-settings/route.ts
-> proxyBackendRequest(..., /api/mcp-report-settings)
```

### 2.3 Read consumers

`GET /api/mcp-report-settings` đang là read contract chung cho trang quản trị và biểu mẫu báo cáo thị trường. A5.4.3 chỉ thay mutation owner, không đổi DTO đọc hoặc hành vi lựa chọn đang dùng.

## 3. Backend ownership hiện tại

### 3.1 Group create/update trong Foundation transitional API

File:

```text
apps/backend/foundation/transitional-api.js
```

Functions:

```text
createSettingGroup
updateSettingGroup
```

Gateway đã intercept:

```text
POST  /api/mcp-report-setting-groups
PATCH /api/mcp-report-setting-groups
```

Nhưng handler vẫn tự chứa provider details:

```text
mcp_setting_groups
POST/PATCH PostgREST
id=eq.<groupId>
```

Đây mới chỉ là auth boundary, chưa phải application/database ownership đúng.

### 3.2 Item create/update trong legacy backend

File:

```text
apps/backend/server.js
```

Functions:

```text
createMcpReportSettingV1
updateMcpReportSettingV1
```

Routes:

```text
POST  /api/mcp-report-settings
PATCH /api/mcp-report-settings
```

Foundation chưa intercept hai mutation này nên request được chuyển tiếp vào legacy runtime tại `127.0.0.1:3102`.

## 4. Bốn fingerprints phải retire

```text
6ae585a158e2fd800062fb45  Foundation POST  mcp_setting_groups
500b241ecd80ff8d74047e27  Foundation PATCH mcp_setting_groups
ea3fdd0cec40084d8ba06c1f  legacy POST      mcp_setting_items
204c2501e1755878fd26bf36  legacy PATCH     mcp_setting_items
```

Khi implementation hoàn tất và retirement ledger/policy được cập nhật:

```text
direct REST mutation debt: 7 -> 3
```

Ba findings còn lại thuộc A5.4.4, không được kéo vào A5.4.3:

```text
474001fbfa0d1de1ed003364  field-check update
f70d562b03f15f08cae868e8  field-check create
ffb1c503e59aa8fcf8f0344f  market-report create
```

## 5. Audit production database

Production hiện có:

```text
mcp_setting_groups: 7 rows
mcp_setting_items:  52 rows
group_type:         market_report
statuses:           active
orphan items:       0
blank keys/titles:  0
blank item keys/labels: 0
```

Schema đã có:

```text
mcp_setting_groups primary key (id)
UNIQUE (group_key)

mcp_setting_items primary key (id)
FOREIGN KEY (group_id) -> mcp_setting_groups(id) ON DELETE CASCADE
UNIQUE (group_id, item_key)
FOREIGN KEY (product_id) -> products(id)
```

RLS đang bật. `anon` và `authenticated` chỉ có SELECT; `service_role` là đường ghi. Không có public function/RPC chứa `setting` tại thời điểm audit.

Điểm cần lưu ý: database đã có uniqueness vật lý, nhưng mutation hiện chưa có transaction/RPC owner để chuẩn hóa validation, locking, context và error contract.

## 6. Lỗi logic/rủi ro đã xác định

### 6.1 Split owner

Group mutation chạy trong Foundation transitional handler, item mutation chạy trong legacy backend. Cùng một aggregate settings nhưng có hai owner và hai cách xử lý lỗi/context.

### 6.2 Direct provider coupling trong transport

Table names và PostgREST query strings nằm trực tiếp trong transport handlers. Transport đang làm luôn validation, mapping và repository work.

### 6.3 Item create không atomic

Legacy flow hiện tại:

```text
SELECT group exists
-> POST mcp_setting_items
```

Hai request DB tách rời nên existence check và insert không cùng transaction. Foreign key có thể chặn orphan, nhưng lỗi provider không được chuyển thành business error ổn định.

### 6.4 Retry có thể sinh duplicate key không ổn định

Khi slug rỗng, code dùng `Date.now()` để tạo `group_<timestamp>` hoặc `item_<timestamp>`. Retry cùng payload có thể tạo key khác và chèn thêm record thay vì trả conflict/idempotent result.

### 6.5 Validation chưa đủ

- Group create chỉ bắt buộc `title`.
- Item create chỉ bắt buộc `groupId` và `label`.
- `status`, `groupType` và `sortOrder` chưa được validate thành tập giá trị/range rõ ràng.
- Group update không fail khi PATCH áp dụng 0 row.
- Item update không khóa row trước khi thay đổi.
- Unique violation hiện có nguy cơ lộ provider-shaped error thay vì canonical `409`.

### 6.6 Context không đồng nhất

Group mutation có ghi `foundation_context` vào `raw_payload`; item mutation không ghi requestId/actor/installation context.

Khi update với `meta`, cả hai đường có thể thay toàn bộ `raw_payload`, làm mất metadata cũ hoặc context trước đó.

### 6.7 Không có RPC owner

Production chưa có service-role-only RPC cho create/update group/item. Vì vậy uniqueness, existence, context merge và row-count assertion chưa nằm trong một DB contract duy nhất.

## 7. Boundary triển khai bắt buộc

### 7.1 Application owner

Tạo module Foundation riêng, ví dụ:

```text
apps/backend/foundation/report-setting-mutations.js
```

Use cases:

```text
createReportSettingGroup
updateReportSettingGroup
createReportSettingItem
updateReportSettingItem
```

`transitional-api.js` chỉ:

```text
parse request
-> call use case
-> return canonical response
```

Không chứa table name, PostgREST filter hoặc direct mutation.

### 7.2 Gateway routes

Foundation phải intercept đủ bốn route trước legacy forwarding:

```text
POST  /api/mcp-report-setting-groups
PATCH /api/mcp-report-setting-groups
POST  /api/mcp-report-settings
PATCH /api/mcp-report-settings
```

Sau khi test pass, xóa `createMcpReportSettingV1` và `updateMcpReportSettingV1` cùng hai route mutation khỏi legacy owner. GET read contract có thể giữ nguyên trong slice này.

### 7.3 Database contract

Dùng typed RPC, không dùng generic table mutation endpoint. Tên đề xuất:

```text
mcp_create_report_setting_group
mcp_update_report_setting_group
mcp_create_report_setting_item
mcp_update_report_setting_item
```

Mỗi RPC phải:

1. validate ID, title/label, key, status, group type và sort order;
2. dùng deterministic normalized key, không fallback timestamp;
3. kiểm tra/lock group hoặc item liên quan;
4. dựa trên unique constraints hiện có và map duplicate thành canonical `409`;
5. fail nếu update áp dụng 0 row;
6. merge `raw_payload` thay vì xóa metadata cũ;
7. lưu Foundation context gồm requestId, actor, installation và NPP code;
8. trả DTO cần thiết, không lộ table/provider diagnostics;
9. chỉ grant EXECUTE cho `service_role`.

Không thêm persisted idempotency store ở A5.4.3; phần đó thuộc A5.5. Tuy nhiên natural key và transaction phải khiến retry không âm thầm tạo duplicate.

## 8. Error contract đề xuất

```text
400  payload/status/sortOrder/key không hợp lệ
404  group hoặc item không tồn tại
409  group_key hoặc (group_id,item_key) bị trùng
500  invariant nội bộ lỗi
502/503 provider failure đã được neutralize
```

Không trả provider table, SQL, RPC diagnostics hoặc Supabase response body ra public API.

## 9. Test và rollout checklist

### Source/CI

```text
[ ] migration source contract tests cho 4 RPC
[ ] service_role-only permission tests
[ ] report-setting mutation use-case tests
[ ] Gateway route interception tests đủ 4 route
[ ] group/item not-found tests
[ ] duplicate key conflict tests
[ ] raw_payload/context merge tests
[ ] provider diagnostics sanitizer tests
[ ] caller audit regression test
[ ] direct mutation scanner debt 7 -> 3
[ ] retirement ledger ghi đủ 4 fingerprints
[ ] backend verify pass
[ ] TypeScript/build pass
```

### Production DB

```text
[ ] apply migration mới; không sửa migration đã chạy
[ ] service_role execute = true
[ ] anon/authenticated execute = false
[ ] create/update group smoke có cleanup
[ ] create/update item smoke có cleanup
[ ] duplicate retry/conflict smoke
[ ] không còn smoke rows
```

### Deploy

```text
[ ] merge PR
[ ] VPS pullmcp
[ ] PM2 online/restart ổn định
[ ] health/auth/CORS smoke pass
[ ] authenticated mutation smoke qua Gateway
[ ] Vercel production chỉ là gate nếu proxy/frontend source thay đổi hoặc cần release đồng bộ
[ ] cập nhật CURRENT_PROGRESS.md và evidence này
```

Rollback phải ưu tiên forward-fix migration. Nếu runtime cần rollback, giữ RPC mới tương thích và rollback application commit; không sửa/xóa migration production đã chạy.

## 10. Trạng thái sau audit

```text
AUDIT:           COMPLETE
CODE CHANGE:     NONE
MIGRATION:       NONE
SCANNER BASELINE: 7 (không đổi vì audit-only)
IMPLEMENTATION:  NOT STARTED
NEXT TARGET:     A5.4.3 implementation, debt 7 -> 3
```

Không bắt đầu A5.4.4 hoặc Order Core trước khi A5.4.3 implementation, CI, production DB smoke và VPS deployment được ghi nhận.