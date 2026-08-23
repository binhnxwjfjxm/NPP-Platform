# Admin UI/UX — Lô 0 audit và layout matrix

> Issue nguồn: #749  
> Phạm vi: **chỉ Admin app**  
> Source mặc định: `admin/web/**`  
> Baseline audit: `main@ff15ea85d0321428d07be03ba8a09350849818e8`  
> Trạng thái tài liệu: **LÔ 0 — AUDIT / DECISION LOCK**

---

## 1. Mục tiêu của Lô 0

Lô 0 chỉ làm ba việc:

1. kiểm kê đầy đủ route/màn hình và primitive UI đang có trong Admin;
2. chỉ ra phần nào đã đúng, phần nào đang trùng/lệch và phần nào thật sự cần dùng chung;
3. khóa layout matrix để Lô 1 không tạo thêm một hệ component song song hoặc sửa theo cảm tính.

**Lô 0 không redesign màn hình, không đổi nghiệp vụ, không đổi API, không migration, không deploy production.**

Phạm vi tiếp tục giữ đúng ranh giới sản phẩm đã khóa ở #606:

```text
Tổng quan | Đề xuất | Cảnh báo | Báo cáo
```

Admin là ứng dụng quản trị riêng. Task này không đụng MCP Field, Công Ty, Delivery, Retail, Website hoặc Customer Ordering.

---

## 2. Nguồn đã audit

Đã đọc và đối chiếu:

- `NPP_PLATFORM_MASTER_PLAN.md`;
- `docs/operations/master-plan-frontend-runtime-addendum.md`;
- `docs/operations/admin-mobile-management-ui-spec.md`;
- Issue #606;
- Issue #749;
- current `main`;
- route tree và source hiện tại trong `admin/web/**`;
- CSS global/module của Admin;
- test Admin hiện có, đặc biệt MCP supervision UX.

Runtime addendum hiện hành xác nhận `admin/web/**` là frontend **Admin MCP/NPP** độc lập. Việc chuẩn hóa layout Admin không tạo business authority mới và không làm Admin thành bản sao của Công Ty.

---

## 3. Baseline Git / CI / overlap

### Current main

Audit ngay trước khi tạo branch:

```text
ff15ea85d0321428d07be03ba8a09350849818e8
Merge pull request #748
feat(admin): hoàn thiện Lô D cảnh báo và xuất báo cáo
```

PR #748 đã merge. Exact PR head `81038d2346f43f1a64ad259607add918f440ba13` đã có các workflow liên quan hoàn tất `success`, gồm `Admin frontend CI` và `Core UI and Browser E2E`.

Merge commit `ff15ea85...` không có workflow run riêng tại thời điểm audit; không được suy diễn trạng thái production từ việc source đã merge.

### Open PR

Không có PR mới tạo trong ngày 2026-08-23 còn mở tại thời điểm audit.

Tìm kiếm PR mở có chữ `admin` chỉ thấy các PR lịch sử cũ:

- #480 — docs-only handoff, không sửa ứng dụng Admin;
- #234 — chủ yếu NPP Operations, chỉ có một Admin boundary regression test, không thay giao diện Admin.

=> **Không có overlap active đã phát hiện với `admin/web/app/**` cho Lô 0.**

### Branch lịch sử

Repo còn nhiều branch `agent/admin-*` từ các lô trước. Branch tồn tại không được coi là task đang chạy. Các PR Admin gần nhất đã audit như #743 và #748 đều đã merge/closed.

Branch Lô 0 được tạo từ exact current main:

```text
agent/admin-ui-layout-lot0-audit
```

---

## 4. Route inventory toàn Admin

### 4.1 Route người dùng

| Route | Mục đích | Ghi chú |
| --- | --- | --- |
| `/` | Tổng quan quản trị | Top-level |
| `/approvals` | Trung tâm Đề xuất | Route kỹ thuật kế thừa, user-facing là `Đề xuất` |
| `/approvals/[approvalId]` | Chi tiết và quyết định Đề xuất | Detail có mutation quản trị |
| `/alerts` | Trung tâm Cảnh báo | Top-level |
| `/alerts/[alertId]` | Chi tiết/lifecycle Cảnh báo | Detail có mutation trạng thái |
| `/reports` | Trung tâm Báo cáo | Top-level |
| `/reports/[reportId]` | Báo cáo chi tiết | MCP dùng experience riêng trong route này |
| `/menu` | Thông tin ứng dụng / phiên / phạm vi | Secondary system surface |
| `/login` | Đăng nhập / xác minh | Auth surface độc lập |
| `/customer-onboarding` | Redirect kế thừa | Redirect về `/approvals`, không có UI riêng |

### 4.2 System-state surface

| Surface | File | Mục đích |
| --- | --- | --- |
| Loading | `app/loading.tsx` | Trạng thái tải route |
| Error | `app/error.tsx` | Lỗi route + thử lại |
| Not found | `app/not-found.tsx` | 404 nội dung |

### 4.3 Non-visual route — NO-TOUCH trong layout task

Các route sau không phải layout surface:

```text
/api/auth/login
/api/auth/logout
/reports/export
```

Lô UI không sửa các route này trừ khi một regression cụ thể chứng minh cần thiết; mặc định **NO-TOUCH**.

---

## 5. Shared foundation đang có — không được dựng bộ thứ hai

### 5.1 `AdminShell` — KEEP

`admin/web/app/admin-shell.tsx` đã sở hữu đúng các trách nhiệm dùng chung:

- top-level nav cố định `Tổng quan | Đề xuất | Cảnh báo | Báo cáo`;
- icon + label ở desktop;
- bottom nav ở mobile;
- page title + subtitle;
- account menu + logout;
- route alias kế thừa.

**Quyết định:** Lô 1 không tạo `AdminPageShell` thứ hai. Nếu cần chỉnh mật độ/header thì refactor chính `AdminShell` và CSS của nó.

### 5.2 `AdminIconTabs` — KEEP component, ADAPT visual

`admin-icon-tabs.tsx` đã là primitive generic đúng hướng:

```text
href + label + icon + active + badge
```

Nhưng CSS hiện tại biến mỗi tab thành một tile/card cao khoảng 74–78px, có border, shadow và nền gradient active. Đây là điểm lệch rõ với quyết định #749: **tab phải gọn, icon + tên ngắn, active rõ nhưng không dùng card lớn chỉ để làm tab**.

**Quyết định:** reuse `AdminIconTabs`; Lô 1 sửa visual/layout của component hiện tại. **Không tạo `AdminTabs` song song.**

### 5.3 `AdminIcon` — KEEP

`admin-icons.tsx` đã có bộ icon Admin đủ cho các nhóm hiện tại: tổng quan, cảnh báo, kho, vị trí, người dùng, tiền, MCP, giao vận, tài liệu, back, check...

**Quyết định:** không thêm icon library chỉ để redesign. Chỉ bổ sung glyph khi một nghiệp vụ thật sự thiếu biểu tượng phù hợp.

### 5.4 Card / shell token hiện có — REUSE có kiểm soát

`globals.css` đã có:

- `.card`;
- `.metricGrid/.metricCard`;
- page header;
- status pill cơ bản;
- general row/card primitives;
- desktop container tới 1440px.

Không xây một design-token framework mới. Lô 1 chỉ gom những primitive có ít nhất hai consumer thật.

---

## 6. Layout matrix cấp route

Phân loại:

```text
KEEP     = đang đúng, giữ nguyên logic/layout chính
ADAPT    = giữ cấu trúc/component, chỉnh về shared layout
MIGRATE  = đang có local pattern trùng; chuyển sang shared Admin primitive
SPECIAL  = màn đặc thù; chỉ dùng shared chrome/primitives phù hợp, không ép cùng khuôn
```

| Route / surface | Kiểu màn | Header hiện tại | Tab hiện tại | Filter / toolbar | KPI / summary | Shared đang dùng | Gap chính | Layout mục tiêu | Phân loại | File trọng tâm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | dashboard | `AdminShell` title/subtitle | Không có business tab | Kỳ riêng bằng pill + period meta | 4 metric card + decision strip | `AdminShell`, `AdminIcon`, `.card/.metricCard` | Period control tự viết; KPI/summary dùng pattern khác Báo cáo/MCP; hierarchy có nhiều strip/card liên tiếp | Header → kỳ/toolbar gọn → KPI → ưu tiên → trung tâm quản trị | **ADAPT** | `app/page.tsx`, `overview.module.css` |
| `/approvals` | list/decision center | `AdminShell` | `AdminIconTabs` 6 nhóm | Chưa có toolbar riêng | 3 ô summary | `AdminShell`, `AdminIconTabs`, `.card` | Tab component đúng nhưng visual tile quá cao; status/priority pill riêng; empty/list pattern riêng | Header → icon tabs gọn → summary/KPI gọn → list | **ADAPT** | `approvals/page.tsx`, `admin-management-shell.css` |
| `/approvals/[approvalId]` | detail/action | `AdminShell` | Không | Back link; action sticky cuối màn | Hero status/impact | `AdminShell`, `.card` | Nhiều card dọc; action bar class mang tên riêng proposal; textarea style inline; cần hierarchy detail thống nhất | Back/context → detail hero → section stack → sticky decision action | **SPECIAL** | `approvals/[approvalId]/page.tsx`, `admin-management-shell.css` |
| `/alerts` | list/rules/history | `AdminShell` | `AdminIconTabs` 8 nhóm | `period` tồn tại trong query nhưng chưa có một toolbar thống nhất | 3 ô summary | `AdminShell`, `AdminIconTabs`, `.card` | Badge/list/empty riêng; tabs dài; toolbar/filter chưa thống nhất với Reports/MCP | Header → icon tabs gọn → toolbar kỳ/filter nếu có → summary → list/rules/history | **ADAPT** | `alerts/page.tsx`, `admin-management-shell.css` |
| `/alerts/[alertId]` | detail/action | `AdminShell` | Không | Back link; lifecycle action | Hero severity/status + comparison | `AdminShell`, `.card` | Dùng lại class `approvalDecisionBar` cho cảnh báo → semantic CSS bị rò tên domain; detail sections trùng proposal | Back/context → detail hero → evidence/assessment/history → neutral shared action bar | **SPECIAL** | `alerts/[alertId]/page.tsx`, `admin-management-shell.css` |
| `/reports` | report center | `AdminShell` | `AdminIconTabs` 8 nhóm | Period pill riêng; warehouse filter nằm trong card và reuse style period | Hero + KPI + trend + highlight | `AdminShell`, `AdminIconTabs`, `.card` | Filter hierarchy phân tán; period style duplicate Overview/MCP; report content desktop bị khóa max 760 dù shell tới 1440 | Header → icon tabs gọn → toolbar kỳ/kho → status → KPI/summary → report content/actions | **MIGRATE** | `reports/page.tsx`, `report-center.module.css` |
| `/reports/[reportId]` non-MCP | detail/drill-down | `AdminShell` | Không | Back link; scope info | Metrics trong section | `AdminShell`, `.card` | Generic detail đang hợp lý nhưng width/section/status chưa đồng nhất với proposal/alert detail | Back/context → report header → scope/metrics → drill-down → notes/source | **ADAPT** | `reports/[reportId]/page.tsx`, `report-center.module.css` |
| `/reports/[reportId]` MCP | dashboard/list/detail/map hybrid | `AdminShell` title `Giám sát MCP` | **Local text pill tab** | Local period bar + search/filter per view | Local KPI cards/stats | Hầu hết local module | Là hotspot duplicate lớn nhất: tabs, period, badge, search, filter chip, KPI, action, list, empty state đều tự định nghĩa | Shared Admin tabs/toolbar/KPI/status/list chrome; nội dung MCP đặc thù giữ nguyên | **MIGRATE** | `reports/mcp-supervision.tsx`, `mcp-supervision.module.css` |
| `/menu` | system/settings | `AdminShell` | Không | Không | Không | `AdminShell`, `.card`, settings rows | Không có vấn đề layout chung đáng để kéo vào redesign | Giữ secondary settings surface; chỉ nhận token chung khi có | **KEEP** | `menu/page.tsx` |
| `/login` | auth | Full-page riêng | Không | Form auth | Không | CSS module riêng | Auth flow là surface đặc thù, không nên ép vào management shell/tabs | Giữ auth layout; chỉ đồng bộ branding/token nếu thật sự cần | **SPECIAL** | `login/page.tsx`, `login.module.css` |
| `/customer-onboarding` | redirect | Không | Không | Không | Không | `ADMIN_ROUTE_ALIASES` | Không có UI | Giữ redirect tương thích | **KEEP** | `customer-onboarding/page.tsx` |
| Loading | system state | `AdminShell` | Không | Không | Không | `.adminRouteState` | Có primitive nhưng route/error/empty trong từng module vẫn đang dùng nhiều lớp riêng | Chuẩn state dùng chung cho route/module khi phù hợp | **ADAPT** | `loading.tsx`, `admin-closeout.css` |
| Error | system state | Full-page riêng | Không | Retry + về Tổng quan | Không | `.adminRouteState` | Không dùng `AdminShell`, khác loading/not-found có chủ đích vì error boundary client; visual vẫn có thể chung primitive | Giữ boundary, thống nhất state visual/action | **ADAPT** | `error.tsx`, `admin-closeout.css` |
| Not found | system state | `AdminShell` | Không | Về Tổng quan | Không | `.adminRouteState` | Cơ bản đúng | Giữ, nhận shared state token | **KEEP** | `not-found.tsx`, `admin-closeout.css` |

---

## 7. Layout matrix riêng cho MCP supervision

MCP supervision là một route nhưng có nhiều view theo query. Không được coi chỉ là một màn.

| View | Kiểu | Control hiện tại | Nội dung chính | Target | Phân loại |
| --- | --- | --- | --- | --- | --- |
| `overview` | dashboard | local MCP tabs + period | 4 KPI, tiến độ, bất thường gần nhất | shared tabs + toolbar + KPI; giữ dữ liệu/logic | **MIGRATE** |
| `people` | list | local tabs + period + search | nhân viên, badges, actions, pagination | shared tabs/toolbar/status chrome; giữ flat list | **MIGRATE** |
| `person` | detail | local tabs + period + back | profile, stats, tuyến, session timeline | shared detail chrome/status; giữ profile/timeline chuyên biệt | **SPECIAL** |
| `routes` | list | local tabs + period + search | tuyến, tỷ lệ ghé, actions | shared tabs/toolbar/status/list chrome | **MIGRATE** |
| `outlets` | list/filter | local tabs + period + search/status chip | điểm bán, trạng thái ghé/vị trí | shared tabs/toolbar/filter chip/badge | **MIGRATE** |
| `outlet` | detail | local tabs + period + back | thông tin điểm bán/phiên/bằng chứng | shared detail chrome; giữ evidence chuyên biệt | **SPECIAL** |
| `checkin` | detail | local tabs + period + back | GPS/check-in/accuracy/đánh giá | shared detail/status chrome; giữ dữ liệu GPS | **SPECIAL** |
| `map` | map | local tabs + period + route context | SVG map + legend | chỉ chuẩn hóa chrome/toolbar/legend token; map giữ chuyên biệt | **SPECIAL** |
| `anomalies` | list/filter | local tabs + period + filter | bất thường + link Alert | shared tabs/toolbar/filter/status/list | **MIGRATE** |

### Bảo vệ bắt buộc khi migrate MCP

Test hiện tại khóa các điểm đúng và Lô UI không được phá:

- flat large-data navigation, không quay về nested `<details>`;
- `PAGE_SIZE = 25` cho các list hiện hành;
- đủ các entry `Tổng quan / Nhân viên / Tuyến / Điểm bán / Bất thường`;
- search/filter/pagination hiện hữu;
- drill-down nhân viên/tuyến/điểm bán/check-in;
- map tuyến;
- read-only reporting;
- không bịa định vị nhân viên theo thời gian thực;
- không đổi backend fact GPS hay kết luận vị trí chỉ vì đổi UI.

---

## 8. Duplication / semantic leakage đã chứng minh

### 8.1 Business tab

Hiện có hai implementation:

1. `AdminIconTabs` — generic, icon + label + badge;
2. MCP `.tabBar/.tab` — text pill local.

**Quyết định:** chỉ giữ một hướng business tab là `AdminIconTabs`. MCP sẽ migrate ở Lô 2/reference implementation, không tạo `McpTabs` mới.

### 8.2 Period/filter control

Period control đang tự viết ít nhất ba lần:

- `overview.module.css`;
- `report-center.module.css`;
- `mcp-supervision.module.css`.

Warehouse filter trong Reports còn dùng lại visual period pill dù semantic là filter kho.

**Đây là bằng chứng đủ mạnh cho một shared toolbar/filter-row ở Lô 1.**

Business tab và filter chip phải là hai semantic khác nhau:

- business tab: icon + label, đổi khu vực nội dung;
- period/status/warehouse: control nhỏ gọn trong toolbar, không giả làm business tab.

### 8.3 KPI/summary

Hiện có ít nhất bốn presentation:

- `.metricCard` ở Tổng quan;
- `.kpi` ở Report Center;
- `.kpiCard` ở MCP;
- `approvalSummaryStrip/alertSummaryStrip/overviewDecisionStrip`.

**Quyết định:** Lô 1 cần shared KPI/summary primitive gọn, có variant tối thiểu; không copy thêm kiểu thứ năm.

### 8.4 Status badge

Status/priority/severity đang có ba họ local:

- Proposal: `approvalPriority/approvalState`;
- Alert: `alertSeverity/alertStatus`;
- MCP: local `Badge` + tone CSS module.

**Quyết định:** đủ consumer để tạo semantic `AdminStatusBadge`/equivalent ở Lô 1. Mapping label vẫn thuộc domain; shared primitive chỉ sở hữu tone/shape/accessibility.

### 8.5 Action bar ở detail

`AlertDetailPage` đang dùng class tên `approvalDecisionBar`.

=> Đây là semantic leakage rõ ràng giữa hai domain.

**Quyết định:** Lô 1 được phép chuẩn hóa một neutral Admin detail/action-bar primitive vì đã có ít nhất hai consumer thật. Không đổi mutation/lifecycle.

### 8.6 Empty/loading/error states

Hiện có:

- global `adminRouteState`;
- proposal `approvalEmpty`;
- alert `alertEmpty`;
- MCP `emptyState/emptyInline`;
- report `detailNote` đôi lúc kiêm trạng thái.

**Quyết định:** Lô 1 chuẩn hóa state chrome/tone. Nội dung lỗi/quyền/partial-data vẫn do từng domain quyết định; tuyệt đối không gom lỗi thành `0` hoặc một message chung.

### 8.7 CSS layering

`app/layout.tsx` hiện load liên tiếp:

```text
globals.css
hung-phat-warm-gold.css
admin-mobile-app.css
admin-management-shell.css
admin-closeout.css
```

Ngoài ra Overview, Reports và MCP có CSS module riêng.

Không nên rewrite toàn bộ CSS trong một lô. Nhưng Lô 1 phải tránh tiếp tục thêm override cuối chuỗi cho cùng component.

**Quyết định:** shared layout rules mới phải có một ownership rõ; duplicate cũ chỉ xóa khi consumer đã migrate và search chứng minh không còn dùng.

---

## 9. Những abstraction đã đủ bằng chứng để làm ở Lô 1

### PROVEN — được phép chuẩn hóa ngay

1. **Page header density trong `AdminShell`** — component đã có, chỉ adapt.
2. **`AdminIconTabs`** — component đã có, đổi từ tile/card sang compact icon + label tab.
3. **Admin toolbar/filter row** — period/filter lặp ở Overview, Reports, MCP.
4. **Filter/segment chip** — period/status/warehouse cần semantic chung nhưng khác business tab.
5. **Status badge** — Proposal, Alert, MCP đều dùng.
6. **KPI/summary card** — Overview, Reports, MCP và summary strip đều có.
7. **Route/module state** — loading/error/empty/partial-data có nhiều consumer.
8. **Neutral detail action bar** — Proposal + Alert cùng cần.

### CONDITIONAL — chưa được tạo component riêng nếu chưa có consumer thứ hai

- `AdminSearch`: hiện search rõ ràng chủ yếu tập trung ở MCP supervision. Lô 1 ưu tiên toolbar có slot/form contract; chỉ tách Search riêng khi route thứ hai thật sự dùng.
- `AdminPagination`: hiện MCP là consumer chính. Giữ local cho đến khi có consumer thứ hai.
- `AdminDataTable`: current Admin chủ yếu là card list/flat list/drill-down, chưa có đủ bằng chứng cho một table framework.
- `AdminListRow`: Proposal/Alert/MCP có data shape khác nhau; chỉ extract chrome tối thiểu nếu migration chứng minh markup lặp thật.
- `AdminSection`: có thể tạo nếu giúp detail/report dùng chung mà không ép nội dung đặc thù vào một schema props lớn.

### KEEP LOCAL / SPECIAL

- MCP SVG map và map logic;
- generic report drill-down tree;
- report trend/spark bars;
- login/OTP form flow;
- Proposal decision form fields;
- Alert lifecycle mutation;
- GPS evidence/logic;
- business-specific label/status mapping.

---

## 10. Width / density archetype cần khóa cho Lô 1

Current source đang có ba vùng width khác nhau:

- shell/main có thể rộng tới 1440px;
- generic Reports/detail thường khóa khoảng 760px;
- MCP supervision rộng khoảng 1040px.

Không ép tất cả thành 760px hoặc tất cả thành full 1440px.

Lô 1 phải hỗ trợ tối thiểu ba archetype:

```text
WIDE
dashboard / list / report / MCP supervision
-> tận dụng desktop 1366/1440/1920

FOCUSED
proposal detail / alert detail / text-heavy report detail
-> chiều đọc có giới hạn, không trải chữ quá rộng

SPECIAL
map / auth / drill-down đặc thù
-> giữ geometry theo use case, chỉ dùng shared chrome phù hợp
```

Exact max-width là implementation detail của Lô 1; không khóa số mới trong Lô 0 nếu chưa test responsive thực tế.

---

## 11. Layout contract mục tiêu

### Màn list/report/dashboard

```text
AdminShell / page header
-> business tabs (nếu có)
-> toolbar: kỳ / search / status / scope / action phụ
-> KPI / summary (nếu có)
-> nội dung chính
-> pagination/action cuối nếu cần
```

### Màn detail

```text
AdminShell / page header
-> back/context
-> detail hero + status
-> section nội dung/bằng chứng/lịch sử
-> action bar nếu lifecycle có mutation
```

### Quy tắc

- không lặp cùng một tiêu đề ở header + tab + card hero nếu không thêm ngữ cảnh;
- business tab không dùng card lớn;
- filter không giả làm business tab;
- CTA chính tối đa một hành động nổi bật trong một vùng khi nghiệp vụ cho phép;
- status dùng badge/tone có meaning, không dùng màu trang trí;
- lỗi/partial data giữ đúng trạng thái, không đổi thành `0`;
- desktop ưu tiên mật độ và khả năng quét dữ liệu; mobile vẫn responsive nhưng không biến desktop thành UI điện thoại kéo dài.

---

## 12. File impact map cho các lô sau

### Shared foundation — Lô 1 ưu tiên

```text
admin/web/app/admin-shell.tsx
admin/web/app/admin-icon-tabs.tsx
admin/web/app/admin-icons.tsx             # chỉ khi thiếu glyph thật
admin/web/app/globals.css
admin/web/app/admin-management-shell.css
admin/web/app/admin-mobile-app.css
admin/web/app/admin-closeout.css
admin/web/test/**                          # regression UI structure
```

Không bắt buộc chạm tất cả file; đây là vùng audit cho foundation.

### Reference MCP — Lô 2

```text
admin/web/app/reports/[reportId]/page.tsx
admin/web/app/reports/mcp-supervision.tsx
admin/web/app/reports/mcp-supervision.module.css
admin/web/test/mcp-report-experience.test.mjs
admin/web/test/mcp-supervision-ux.test.mjs
```

### Migrate report/list — Lô 3

```text
admin/web/app/reports/page.tsx
admin/web/app/reports/report-center.module.css
admin/web/app/alerts/page.tsx
admin/web/app/approvals/page.tsx
```

### Special/detail/overview — Lô 4

```text
admin/web/app/page.tsx
admin/web/app/overview.module.css
admin/web/app/approvals/[approvalId]/page.tsx
admin/web/app/alerts/[alertId]/page.tsx
admin/web/app/reports/[reportId]/page.tsx
```

`/menu`, `/login`, legacy redirect và non-visual routes không được kéo vào migration chỉ để tăng phạm vi.

---

## 13. Lô 1 — allowlist / no-touch đã khóa từ audit

### Lô 1 được làm

- refactor shared Admin chrome/layout primitives đã chứng minh ở mục 9;
- đổi visual `AdminIconTabs` về compact icon + label;
- khóa toolbar/filter/KPI/status/state/action-bar pattern;
- cập nhật responsive/focus/keyboard styles tương ứng;
- test shared primitives và regression route structure.

### Lô 1 chưa làm

- không migrate toàn bộ page sang pattern mới;
- không redesign riêng MCP;
- không đổi report query/data;
- không đổi Proposal/Alert lifecycle;
- không đổi quyền;
- không backend;
- không database/migration;
- không MCP Field/Công Ty/Delivery/Retail/Website/Customer Ordering;
- không deploy production.

Lô 2 mới dùng MCP supervision làm reference implementation hoàn chỉnh.

---

## 14. Acceptance gate Lô 0

- [x] Đã audit current `main` ngay trước branch.
- [x] Đã đọc Master Plan, runtime addendum, Admin spec, #606 và #749.
- [x] Đã kiểm open PR và overlap Admin.
- [x] Đã kiểm toàn bộ route người dùng trong `admin/web/app/**`.
- [x] Đã kiểm route detail/drill-down.
- [x] Đã tách các view nội bộ của MCP supervision, không coi chúng là một màn duy nhất.
- [x] Đã kiểm `/menu`, `/login`, legacy redirect và system states.
- [x] Đã phân biệt visual routes với auth/export API routes.
- [x] Đã lập matrix `KEEP / ADAPT / MIGRATE / SPECIAL`.
- [x] Đã chứng minh các primitive đủ điều kiện shared ở Lô 1.
- [x] Đã chỉ rõ các abstraction **chưa đủ bằng chứng**, tránh over-engineering.
- [x] Đã khóa app boundary: chỉ Admin.
- [x] Không sửa UI/business logic trong Lô 0.
- [x] Không migration/provider/deploy production.

---

## 15. Kết luận Lô 0

Admin **không thiếu nền tảng hoàn toàn**. Ba primitive quan trọng đã tồn tại và phải được giữ làm gốc:

```text
AdminShell
AdminIconTabs
AdminIcon
```

Vấn đề chính hiện tại là **presentation bị phân mảnh sau nhiều lô**:

- `AdminIconTabs` đang bị style thành card/tile quá cao;
- Overview, Reports và MCP tự dựng period/filter control riêng;
- Proposal, Alert, MCP có ba hệ status badge;
- KPI/summary có nhiều kiểu;
- MCP supervision tự sở hữu gần trọn một mini UI system;
- detail action bar đang rò semantic class giữa Proposal và Alert;
- CSS shared được chồng qua nhiều file override.

Vì vậy hướng đúng cho Lô 1 là **refactor foundation đang có, không xây lại Admin và không tạo design system thứ hai**.

Thứ tự sau Lô 0:

```text
Lô 1 — shared Admin layout foundation
-> Lô 2 — MCP supervision làm reference implementation
-> Lô 3 — migrate report/list/monitoring
-> Lô 4 — overview/detail/special surfaces
-> Lô 5 — regression toàn Admin
```
