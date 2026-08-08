# Phase 9 — MCP migration, access closure & infrastructure cutover

Parent issue: #386

Baseline khi khóa plan: `main@efe2069eb81e84e78c26339d82f821e8a95deabd`.

Tài liệu này bổ sung chi tiết cho mục Phase 9 trong `NPP_PLATFORM_MASTER_PLAN.md`. Khi Phase 9 được thực hiện, issue #386 và tài liệu này là nguồn quyết định chi tiết; Master Plan vẫn giữ vai trò roadmap cấp cao.

## 1. Mục tiêu

Phase 9 hoàn tất kiến trúc đích của installation:

- MCP backend chạy trên Heroku runtime riêng nhưng dùng chung PostgreSQL installation với Core;
- Supabase/VPS không còn là dependency production bắt buộc;
- MCP media dùng R2 đích và media legacy được di chuyển/đối soát;
- Access/RBAC bao phủ đầy đủ chức năng hiện có;
- Customer Ordering đi vào canonical Core Sales Order;
- Core, MCP và Customer Portal không tạo ba order lifecycle độc lập;
- route/navigation của toàn bộ frontend không để nghiệp vụ bị mồ côi;
- Vercel/Heroku/DNS/env được khóa theo runtime thật;
- cutover có backup, restore rehearsal, reconciliation và rollback/forward-fix.

## 2. Runtime topology đã audit khi lập plan

Vercel hiện có sáu project độc lập:

1. Website
2. Customer Ordering
3. NPP Operations
4. MCP Field
5. Admin MCP/NPP
6. Delivery

Website và Customer Ordering cùng repo `binhnxwjfjxm/nguyenlieuhungphat` nhưng deploy thành hai project riêng.

Backend:

- Core backend: Heroku runtime Core;
- MCP backend: Heroku runtime MCP;
- một PostgreSQL installation dùng chung, tách schema theo domain.

Phase 9 không tạo lại Vercel project đã có. Công việc Vercel là audit/lock repo, root directory, branch, domain, env và manual deploy boundary.

## 3. Owner decisions

### 3.1 Role là cấu hình của doanh nghiệp

Role không phải danh sách cứng do hệ thống ép dùng.

Luồng tạo role mục tiêu:

```text
Tạo vai trò
-> có thể chọn preset gợi ý
-> hệ thống tích sẵn permission đề xuất
-> chủ công ty/Admin thêm hoặc bỏ permission
-> đặt tên role theo doanh nghiệp
-> lưu role + permission thực tế
```

Nguyên tắc:

- preset chỉ là gợi ý;
- người có quyền quản trị role luôn có thể thêm/bớt permission khi tạo;
- role đã tạo vẫn có thể chỉnh permission sau này;
- backend authorize bằng permission + scope thực tế;
- không suy permission từ tên role;
- deny-by-default giữ nguyên.

Preset gợi ý có thể gồm Owner/Admin, Manager/Auditor, Sales Manager, Sales Rep, Purchasing, Warehouse Manager, Warehouse Operator, Accounting AR/AP, Dispatcher, Driver/Delivery, MCP Field/Field Sales và Logistics Manager. Đây không phải danh sách role bắt buộc.

### 3.2 Permission UI phải phản ánh permission catalog thật

Phase 9 phải audit toàn bộ permission registry và route/action sử dụng permission.

Phải phát hiện các trường hợp:

- backend có permission nhưng UI phân quyền chưa hiện;
- UI có action nhưng permission contract không đầy đủ;
- module label/grouping đã cũ so với catalog hiện tại;
- feature chỉ có API nhưng không có UI: phải ghi rõ intentional hay defect.

Không giải quyết bằng cách cấp quyền rộng theo role name.

### 3.3 Internal identity và Customer identity tách nhau

- Nhân viên nội bộ: Core `shared.users`, employee, role, permission, scope.
- Không dùng Clerk để tạo/quản lý nhân viên nội bộ.
- Clerk chỉ dành cho external customer của Customer Ordering.
- Clerk xác thực identity; Core sở hữu customer/account membership và authorization nghiệp vụ.

### 3.4 Một canonical Sales Order, ba nguồn intake

```text
NPP Operations / Internal
MCP Field -> MCP API
Customer Ordering -> Customer Portal API
            |
            v
       Core Sales Order
            |
            v
       sales lifecycle
```

Core sở hữu customer canonical, SKU/unit, pricing, discount/tax, idempotency, version và lifecycle.

MCP và Customer Portal chỉ là intake channel/projection phù hợp quyền; không sở hữu Sales Order lifecycle riêng.

Màn NPP Operations `/sales/sales-orders` dùng một danh sách canonical với tab nguồn:

```text
[Tất cả] [Nội bộ] [MCP] [Khách hàng]
```

Tab nguồn chỉ là shortcut filter. Search, trạng thái, thời gian và khách hàng vẫn là filter chung.

Không thêm source field mới trước khi audit schema hiện có và MCP source contract hiện hành.

### 3.5 Employee/MCP Performance chia tab con

Giữ một report family/contract Phase 8.4 nhưng chia UI thành:

```text
[Tổng quan]
[Tuyến & phiên]
[Điểm bán / lượt ghé]
[Nhu cầu & đơn hàng]
[Hiệu quả hoạt động]
```

Không tạo query nguồn thứ hai cho từng tab. Filter nâng cao sẽ được tinh chỉnh sau; Phase 9.1 khóa cấu trúc để màn không tiếp tục phình dài.

### 3.6 Admin độc lập với NPP Operations

Admin và NPP Operations là hai app riêng.

- Không xây UX dựa trên nút chuyển qua lại giữa hai app.
- Không redesign Admin trong Phase 9 trừ defect route/dependency trực tiếp chặn cutover.
- Việc sửa trải nghiệm Admin được để cho task Admin riêng sau Phase 9 hoặc track riêng.

### 3.7 MCP R2

MCP media phải dùng namespace/object key canonical riêng, ví dụ:

`mcp-plan/outlets/<installationId>/<routeCustomerId>/...`

Cutover media bắt buộc có:

- inventory metadata và object nguồn;
- manifest;
- count/checksum/missing-object reconciliation;
- copy sang R2 đích;
- smoke upload/read/delete;
- historical media smoke;
- rollback pointer cho tới khi reconciliation đạt.

Không search-replace URL media cũ để giả cutover.

### 3.8 Route reachability là release gate

Cho cả 6 frontend:

- route nghiệp vụ top-level phải có entry point;
- detail/dynamic route phải có parent/drill-down hợp lệ;
- nav href không tồn tại là test failure;
- page không có đường vào phải được phân loại intentional deep route hoặc defect;
- permission/API không có UI phải được phân loại intentional API-only hoặc defect.

## 4. Slice plan

### 9.0 — Decision lock & readiness audit

Phạm vi:

- exact main/open PR/CI;
- Master Plan + frontend runtime addendum;
- MCP portability/cutover docs/source;
- 6 Vercel project configuration;
- Core/MCP Heroku boundaries;
- shared PostgreSQL topology;
- Supabase/VPS/R2 dependencies;
- permission catalog + route/action permission map;
- three-order-source contracts;
- six-frontend route/navigation inventory;
- cutover dependency matrix và rollback matrix.

Gate:

- source-of-truth, ownership, identity, permission, order source, storage và production boundary đều được khóa trước mutation.

Không production mutation trong 9.0.

### 9.1 — Access closure + Employee Performance UI structure

Phạm vi:

- role preset/template gợi ý;
- owner/Admin có thể thêm/bớt permission khi tạo role;
- edit role giữ linh hoạt;
- hoàn thiện permission catalog/grouping/UI;
- route/action/permission reconciliation;
- permission + scope fail-closed tests;
- chia Employee/MCP Performance thành 5 tab con, dùng lại Phase 8.4 contracts.

Không redesign Admin.

Gate:

- không còn chức năng production bị thiếu khỏi UI phân quyền mà không có lý do/documentation rõ.

### 9.2 — Customer Ordering -> Core canonical order intake

Phạm vi cross-repo:

- `binhnxwjfjxm/NPP-Platform`;
- `binhnxwjfjxm/nguyenlieuhungphat`.

Việc chính:

- audit Clerk/Core plan hiện có;
- giữ Clerk chỉ cho external customer;
- Customer Portal server boundary;
- Clerk identity -> Core customer/account membership;
- thay mock/browser-only order adapter bằng production adapter;
- canonical catalog/pricing/checkout/order-history contract;
- create order idempotent;
- customer/account isolation;
- không lộ Core server secret ra browser;
- NPP Sales Order source tabs `Tất cả/Nội bộ/MCP/Khách hàng`.

Gate:

- Customer Ordering tạo và đọc lại đúng canonical Core Sales Order, retry không duplicate, source lineage rõ.

### 9.3 — MCP Heroku + PostgreSQL runtime/DB-role closure

Phạm vi:

- audit MCP Heroku app thực tế;
- current release/source/config-name presence;
- shared PostgreSQL attachment;
- runtime DB credential/role behavior;
- migration credential mode;
- least-privilege nếu provider hỗ trợ;
- nếu provider tier không hỗ trợ separated credentials thì ghi đúng mode thật, không giả least privilege;
- production runtime cấm legacy persistence provider.

Gate:

- MCP backend có đường PostgreSQL production đã verify và credential behavior đúng provider reality.

### 9.4 — MCP R2 media migration

Phạm vi:

- runtime R2 config names/presence;
- legacy media metadata/object inventory;
- copy canonical object keys;
- count/checksum reconciliation;
- missing-object report;
- adapter/env switch;
- upload/read/delete/historical smoke;
- lifecycle/retention.

Gate:

- media cần thiết đọc được từ R2 đích; nguồn/bucket cũ không còn dependency production bắt buộc.

### 9.5 — Legacy MCP audit/export + canonical ID mapping

Phạm vi dữ liệu:

- routes;
- route customers/outlets;
- sessions;
- visits;
- order intents/orders;
- report settings;
- media metadata;
- các entity/FK phụ thuộc liên quan.

Việc chính:

- immutable export manifest;
- row counts/checksums;
- old -> canonical ID map;
- collision/unmapped/duplicate report;
- FK lineage validation;
- phân loại operational import vs archive-only.

Gate:

- không import khi còn mapping ambiguity chưa được quyết định.

### 9.6 — Import + adapter replacement + dual verification

- import theo dependency order;
- rerun idempotent;
- PostgreSQL/Core trở thành canonical production source;
- thay Supabase/VPS adapters;
- dual verification nếu cần nhưng không duy trì hai authority;
- count/hash/business reconciliation;
- onboarding + Sales Order bridge end-to-end;
- bỏ production requirement cho legacy provider variables sau gate.

Gate:

- legacy chỉ còn archive/rollback evidence; không còn production authority.

### 9.7 — UI reachability + Vercel/DNS/env cutover

- route manifest 6 frontend;
- route/nav/deep-link/permission reconciliation;
- sửa orphan route thật sự ở owning frontend;
- audit/lock 6 Vercel projects: repo/root/branch/domain/env/Auto Deploy OFF;
- MCP frontend API base trỏ backend mới;
- DNS/env switch theo runbook;
- không redesign Admin ngoài defect chặn cutover.

Gate:

- không route nghiệp vụ top-level mồ côi;
- mỗi frontend chạy đúng backend/source contract.

### 9.8 — Final production cutover & closeout

Chỉ thực hiện sau 9.0–9.7 source gate và lệnh production rõ từ owner.

- fresh shared-DB backup;
- restore rehearsal;
- pre-cutover reconciliation;
- apply pending migrations đúng registry;
- rerun no-op + verify;
- deploy từng runtime riêng;
- Core/MCP/frontend smoke;
- business reconciliation route/outlet/session/visit/order/customer/media;
- three-source Sales Order smoke;
- post-cutover route reachability smoke;
- xác nhận Supabase/VPS không còn required production dependency;
- rollback per runtime, DB forward-fix only;
- closeout evidence.

Gate cuối:

> MCP và Core chạy trên hạ tầng đích; Customer Ordering đi vào Core qua canonical contract; Supabase/VPS không còn dependency production bắt buộc; route/permission/storage/order lineage đều đối soát được.

## 5. Dependency order

```text
9.0
 -> 9.1
 -> 9.2
 -> 9.3
 -> 9.4
 -> 9.5
 -> 9.6
 -> 9.7
 -> 9.8
```

Audit/read-only work có thể chuẩn bị song song khi độc lập, nhưng mutation/cutover không đảo dependency nếu chưa có evidence chứng minh an toàn.

## 6. Git/CI discipline

- `main -> agent/phase-9-<slice>`;
- mỗi slice một issue/branch/PR;
- không dùng lại branch Phase 8;
- gather toàn bộ CI failures + review findings trên cùng exact SHA trước khi sửa;
- batch real fixes thành một additive pass hợp lý;
- không force-push;
- không rerun dồn;
- không tạo thêm SHA khi chưa đủ nguyên nhân;
- finding đúng thì sửa; finding sai thì reject bằng evidence;
- exact-head CI xanh + không còn finding hợp lệ => merge source slice;
- theo main push CI sau merge;
- production mutation/deploy/cutover chỉ trong 9.8 hoặc lệnh production riêng rõ ràng.

## 7. Security and production boundary

- không paste secret/token/API key/password/DATABASE_URL vào repo, issue, PR, log, screenshot hoặc frontend;
- không đưa server secrets ra browser;
- không manual SQL production;
- schema change chỉ qua repo migration;
- PostgreSQL backup là installation-wide;
- Core và MCP backend deploy/release/smoke/rollback riêng;
- Vercel/Heroku Auto Deploy luôn OFF;
- không suy đoán provider/release/backup/migration từ handoff cũ.

## 8. Definition of Done Phase 9

Phase 9 chỉ hoàn tất khi có evidence rằng:

- role/permission quản trị đủ cho feature hiện hữu;
- Customer Ordering dùng Clerk external identity nhưng Core authorization;
- Internal employee không phụ thuộc Clerk;
- Internal/MCP/Customer Portal tạo order qua một canonical Core Sales Order lifecycle;
- NPP Sales Order có source tabs/filter;
- Employee/MCP performance đã tách tab cấu trúc, không duplicate metric source;
- MCP runtime dùng shared PostgreSQL target;
- MCP media dùng R2 target và legacy media reconciled;
- legacy MCP data có export + ID map + import reconciliation;
- Supabase/VPS không còn required production dependency;
- six-frontend route reachability gate pass;
- 6 Vercel project config đã verify;
- fresh backup + restore rehearsal + migration verify + production smoke/reconciliation pass;
- rollback/forward-fix evidence đầy đủ.
