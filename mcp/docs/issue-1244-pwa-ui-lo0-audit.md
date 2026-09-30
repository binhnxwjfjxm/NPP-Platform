# Issue #1244 — MCP PWA UI clean refactor — Lô 0 inventory

> Trạng thái: **LÔ 0 COMPLETE / SOURCE-OF-TRUTH FOR LÔ 1+**  
> Audit baseline NPP Platform: `5c4486f9b3252df3b0dad97141ccf093f0641a40`  
> Mobile reference baseline: `gustavjung01/mcp-mobi@12553c5bd1e555771bddf67862d7763dc96f6b4d`  
> Phạm vi: **chỉ inventory/khóa contract; không đổi UI, API, backend, DB hoặc runtime**  
> Issue: #1244

## 1. Kết luận Lô 0

MCP PWA không thiếu một "theme mới"; vấn đề gốc là lớp trình bày đã tích lũy nhiều thế hệ shell, CSS override và component nối tiếp nhau.

Audit xác nhận:

- `mcp/src/app` có **19 page entry**.
- `mcp/src` có **63 file CSS**.
- `mcp/src/app/layout.tsx` import trực tiếp **36 file CSS global** theo thứ tự; thứ tự import hiện là một phần hành vi giao diện.
- Có **20 CSS Module** có owner theo component tương đối rõ.
- Có **7 file CSS non-module không nằm trong layout và không tìm thấy source caller/import hiện tại**; đây là ứng viên dọn ở Lô 5, chưa xóa ở Lô 0.
- Nhiều primitive bị nhiều file global cùng sở hữu: `.app-shell` xuất hiện ở 18 file CSS app, `.button` ở 22, `.card` ở 17, `.page-header` ở 13, `.bottom-sheet` ở 11.
- Luồng phiên MCP hiện còn wrapper nhiều đời; active chain là `MCPPage -> MCPPageEntryReportReady -> McpSessionCompactView -> McpSessionCompactViewFinal2`.
- PWA và Mobile đang khác taxonomy bottom navigation. PWA hiện dùng `Tổng / Đi tuyến / Khách / Đơn / Báo cáo`, Mobile dùng `Hôm nay / Đi tuyến / Điểm bán / Đơn hàng / Thêm`.
- Theme PWA còn metadata/theme nâu `#754706`; Mobile foundation hiện khóa primary xanh `#1677FF`, navy text, nền sáng, card trắng.
- Business contract hiện đã có test bảo vệ đủ rộng; refactor UI không được thay endpoint/permission/idempotency để “tiện làm UI”.

**Quyết định:** Lô 1+ phải thay ownership UI theo chiều dọc từ foundation/shell/component. Không thêm CSS override để thắng CSS cũ.

---

## 2. Inventory route/page PWA

| Route hiện tại | Entry/owner hiện tại | Vai trò nghiệp vụ phải giữ | Mobile tương ứng | Vị trí UI đích | Owner dự kiến sau refactor |
|---|---|---|---|---|---|
| `/` | `McpDashboardLocalPage` | tổng quan hôm nay, KPI, việc cần xử lý, trạng thái tuyến | `TodayPage` | **Hôm nay** | `TodayScreen` + shared cards/state |
| `/visits` | `VisitsLocalPage -> MCPPage` | phiên đang chạy, danh sách điểm bán, check-in, kết quả ghé, test, báo cáo, follow-up, tạo đơn | `RoutesPage` + outlet detail/action flows | **Đi tuyến** | `RouteWorkScreen` |
| `/customers` | `AccountsPage/AccountsLocalPage/OutletsClientPage` | Điểm bán + Khách Công Ty, tìm kiếm, hồ sơ, GPS, ảnh, liên kết mã | `OutletsPage` | **Điểm bán** | `OutletDirectoryScreen` |
| `/orders` | `OrdersPage -> OrdersLocalPage -> OrdersClientPage` | danh sách đơn, tìm/lọc, chi tiết, tạo đơn, in/xuất | `OrdersPage` | **Đơn hàng** | `OrdersScreen` |
| chưa có route hub riêng | shell/menu hiện tại | gom các nghiệp vụ phụ mà không làm mất capability | `MorePage` | **Thêm** | `MoreScreen` |
| `/routes` | `McpRoutesLocalPage -> MCPPage` | route master, điểm bán trong tuyến, quản lý tuyến theo quyền | `FixedRoutesPage` | Thêm → **Tuyến cố định** | `FixedRoutesScreen` |
| `/mcp/sessions` | `McpSessionsLocalPage -> McpSessionsManagerSafe` | lịch sử phiên, lọc, mở checklist, sửa/xóa phiên hợp lệ, xuất báo cáo | `SessionHistoryPage` | Thêm → **Lịch sử phiên** | `SessionHistoryScreen` |
| `/reports` | `MarketReportsLocalPage` + proposals branch | báo cáo phiên, đơn/test/follow-up, export, analyze, đề xuất | `FieldActivityHistoryPage` / report flows | Thêm → **Báo cáo** | `ReportsScreen` |
| `/field-checks` | `MarketChecksPage` | kết quả thử sản phẩm, cập nhật kết quả | `ProductTrialPage` / history | Thêm → **Kết quả thử sản phẩm** | `ProductTrialsScreen` |
| `/plans` | `ActionsPage` | kế hoạch & công việc/follow-up | `TasksPage`, `FollowupPage` | Thêm → **Kế hoạch & Công việc** | `TasksScreen` |
| `/actions` | redirect `/plans` | alias tương thích cũ | không cần tab riêng | alias giữ tới khi migration link hoàn tất | redirect owner |
| `/customers/onboarding` | `CustomerOnboardingClientPage` | hàng đợi mở/liên kết mã khách | `CustomerOnboardingPage` | Thêm → **Mở hoặc liên kết mã khách** | `CustomerOnboardingScreen` |
| `/customers/onboarding/[routeCustomerId]` | `CustomerOnboardingClientPage` | mở đúng hồ sơ điểm bán cần xử lý | `CustomerOnboardingPage` detail | deep-link từ Điểm bán/Thêm | cùng owner onboarding |
| `/mcp-setting` | `McpReportSettingsPage` | thiết lập lựa chọn/mẫu báo cáo | `ReportSettingsPage` | Thêm → **Thiết lập báo cáo thị trường** | `ReportSettingsScreen` |
| `/mcp-setting/groups` | page quản trị group | quản lý nhóm cấu hình báo cáo theo quyền | capability phụ của Thiết lập báo cáo | nested screen | cùng owner settings |
| `/settings` | `SettingsPage` | cài PWA, hành vi thiết bị, tài khoản/logout | `SettingsPage` | Thêm → **Thiết lập** | `SettingsScreen` |
| `/mcp/settings` | redirect `/mcp-setting` | alias tương thích cũ | không cần tab riêng | alias | redirect owner |
| `/mcp` | `McpHomeLocalPage -> MCPPage` | màn quản lý đi thị trường cũ, chứa capability route/session | Mobile chia vào Đi tuyến + Tuyến cố định | legacy entry; chỉ redirect sau khi parity được chứng minh | không tạo owner UI thứ hai |
| `/visits/order-intent` | redirect `/orders` | alias luồng đơn cũ | không cần tab riêng | alias | redirect owner |
| `/login` | login page | xác thực MCP | `LoginPage` | ngoài app shell | `AuthScreen` |

### Route rule

- Không xóa route alias trong cùng commit với việc đổi shell.
- Route `/mcp` chỉ được retire/redirect sau khi chứng minh tất cả capability đã có owner mới.
- Desktop có thể giữ sidebar, nhưng sidebar phải dùng cùng taxonomy với 5 nhóm Mobile; không được tạo menu nghiệp vụ thứ hai.

---

## 3. Inventory nghiệp vụ/action và API contract phải giữ

### 3.1 Đi tuyến / phiên

| Action | Caller hiện tại | Contract/API | Operation/permission quan sát được |
|---|---|---|---|
| mở phiên | `McpMasterView` | `/api/backend/mcp-day/open-session` | `route-session.open` |
| sửa route customer | `McpMasterView` | `/api/route-customers/:id` | `route-customer.update` |
| thêm route customer | `McpMasterView` | `/api/route-customers` | `route-customer.add` |
| check-in | `McpSessionCompactViewFinal2` | `/api/backend/mcp-day/session-customer/checkin` | `session-customer.checkin.set` |
| kết quả ghé | `McpLineCard` | `/api/backend/mcp-day/session-customer/result` | `session-customer.result.record` |
| thử sản phẩm | `McpSessionCompactViewFinal2` | `/api/backend/mcp-day/session-customer/test` | permission `session-customer.test.create` |
| báo cáo thị trường | `McpSessionCompactViewFinal2` | `/api/backend/mcp-day/session-customer/report` | permission `session-customer.report.create` |
| follow-up | `McpSessionCompactViewFinal2` | `/api/backend/mcp-day/session-customer/followup` | permission `session-customer.followup.create` |
| đổi trạng thái điểm trong phiên | `McpSessionCompactViewFinal2` | `/api/backend/mcp-day/session-customer/status` | permission `session-customer.status.update` |
| thêm khách trong phiên | `McpSessionAddCustomerButton` | `/api/backend/mcp-day/session-customer/add` | `session-customer.add` |
| sửa/chốt/xóa phiên hợp lệ | `McpSessionsManagerSafe`, `VisitsSessionReportPanel` | `/api/backend/mcp-session-actions/:id` | `route-session.update` |
| snapshot/rebuild báo cáo phiên | `McpSessionsManagerSafe` | `/api/mcp-session-report` | `session-report.snapshot.create` |

Các mutation đã đi qua canonical idempotent caller ở nhiều owner hiện tại. Refactor không được tự tạo key mới bằng nối chuỗi UI.

### 3.2 Điểm bán / hồ sơ / media

| Action | Owner hiện tại | Contract/API |
|---|---|---|
| hồ sơ điểm bán | `McpCustomerProfileSheet` | `/api/backend/outlet-media/customer-profile?routeCustomerId=...` |
| tải/xóa ảnh điểm bán | `OutletPhotoManager` / `outlet-media-client` | customer-profile media + `/api/backend/outlet-media/delete` |
| cập nhật vị trí/điều hướng | `RouteCustomerLocationEnhancer`, route direction context | giữ caller hiện tại; UI mới chỉ thay presenter |
| mở/liên kết mã | `CustomerOnboardingClientPage` | `/api/backend/customer-verifications/:id` qua idempotent mutation |
| danh bạ Điểm bán / Khách Công Ty | account local-read/client | giữ hai nguồn tách biệt; không merge identity bằng tên |

### 3.3 Đơn hàng

| Action | Owner hiện tại | Contract/API | Quyền |
|---|---|---|---|
| tạo đơn Công Ty từ MCP | `CoreOrderCreateSheet`, `McpCoreOrdersClient` | `/api/backend/core-sales/orders` | `mcp.sales-order.create` |
| tìm SKU | order create clients | `/api/products/search` | contract hiện tại |
| danh sách/chi tiết/lọc | `OrdersClientPage` | local-read/API hiện hữu | giữ nguyên |
| xuất đơn/mặt hàng | `OrdersClientPage` | `/api/backend/exports/orders.csv?view=orders/items` | giữ nguyên |
| PDF/báo cáo liên quan | orders UI | `/api/pdf/dashboard`, `/api/pdf/market-report` | giữ nguyên |

### 3.4 Báo cáo / thử sản phẩm / đề xuất / thiết lập

| Capability | Owner hiện tại | Contract/API |
|---|---|---|
| cập nhật kết quả thử sản phẩm | `MarketChecksClientPage` | `/api/field-checks/result`, operation `field-check.result.update` |
| báo cáo phiên/export | `MarketReportsClientPage` | session report export, PDF, CSV, Word |
| phân tích báo cáo | `MarketReportsClientPage` | `/api/mcp-session-report/analyze`, operation `session-report.analyze` |
| đề xuất | `McpProposalsPage` | `/api/backend/management-proposals` | `mcp.report.write` |
| cấu hình báo cáo | `McpReportSettingsPage` | `/api/mcp-report-settings` | route được middleware bảo vệ |
| group cấu hình | `/mcp-setting/groups` | `/api/mcp-report-setting-groups` | giữ idempotent caller |

---

## 4. Permission boundary phải giữ

Middleware hiện có các route guard quan trọng:

- `mcp.report-setting.write`
- `mcp.route-customer.write`
- `mcp.route.write`

UI/action layer còn có các permission/operation gate:

- `route-customer.update`
- `route-session.update`
- `session-report.snapshot.create`
- `mcp.sales-order.create`
- `mcp.report.write`
- `field-check.result.update`
- `session-customer.test.create`
- `session-customer.report.create`
- `session-customer.followup.create`
- `session-customer.status.update`

**Rule cho refactor:** shell/navigation có thể ẩn entry theo permission, nhưng action owner vẫn phải tự enforce quyền hiện hữu; không dựa vào “ẩn nút” để thay authorization.

---

## 5. Loading / empty / error / retry inventory

Các owner chính đã có state cần giữ:

| Màn | Loading | Empty | Error | Retry/Refresh |
|---|---:|---:|---:|---:|
| Hôm nay | có | có | có | có |
| Đi tuyến | có | có | có | có |
| Tuyến cố định | có | có | có | có |
| Lịch sử phiên | có | có | có | có |
| Điểm bán | có qua local/account source | có | có | có |
| Đơn hàng | có qua local/client | có | có | có |
| Mở/liên kết mã | có | có | có | có |
| Báo cáo | có/local-read | có | có | export/analyze retry |
| Thử sản phẩm | có | có | có | mutation retry |
| Thiết lập | tùy section | có khi không hỗ trợ | có | refresh/retry theo capability |

Lô 1 phải tạo primitive state chung nhưng không làm mất message/action cụ thể của từng nghiệp vụ.

---

## 6. CSS inventory và bằng chứng ownership xung đột

### 6.1 Tổng số

- CSS dưới `mcp/src`: **63**
- Global CSS import trực tiếp trong `layout.tsx`: **36**
- CSS Module: **20**
- Non-module CSS không thuộc 36 global layout imports: **7**

### 6.2 36 global imports hiện tại

```text
globals.css
mobile.css
order-create-workspace.css
order-popups.css
outlet-profile.css
polish.css
dashboard-home.css
compact-operational.css
mcp-popup-compact.css
mcp-popup-content-ownership.css
mcp-order-tea-filter.css
mcp-order-selected-compact.css
mcp-order-mobile-workbench.css
mcp-order-tree-readable.css
mcp-order-report-style.css
mcp-report-branch.css
mcp-sessions-compact.css
mcp-sessions-color.css
mcp-compact-ui.css
mcp-session-add-customer.css
mcp-order-main-final.css
mcp-scroll-restore.css
export-menu-fix.css
npp-theme.css
app-shell-contract.css
hung-phat-mobile-foundation.css
mobile-app-experience.css
mobile-app-geometry.css
mcp-mobile-primary-flows.css
mcp-mobile-support-flows.css
mobile-home-dashboard.css
mobile-list-summaries.css
mcp-lot-3-flows.css
card-depth.css
satin-metal-actions.css
mcp-sessions-owner-polish.css
```

Ít nhất 21 tên file đã thể hiện lịch sử override/layer (`mobile`, `compact`, `final`, `fix`, `polish`, `lot`, depth/action polish). Tên file không tự chứng minh lỗi, nhưng số owner cùng đụng primitive chứng minh architecture hiện tại không còn single-owner.

### 6.3 Primitive bị nhiều owner cùng chỉnh

Search source hiện tại cho thấy:

- `.app-shell`: **18 file CSS**
- `.button`: **22 file CSS**
- `.card`: **17 file CSS**
- `.page-header`: **13 file CSS**
- `.bottom-sheet`: **11 file CSS**
- `.sidebar`: **6 file CSS**
- `.mobile-app-dock`: **3 file CSS**

Đây là nguyên nhân phải chuyển ownership, không giải bằng specificity mới.

### 6.4 7 non-module CSS không có source import/caller tìm thấy

Ứng viên cleanup Lô 5:

```text
brand-ui.css
mcp-order-picker-final-polish.css
mcp-order-picker-inline.css
mcp-order-picker-popup.css
mobile-nav-tune.css
safe-area.css
shared-primitives.css
```

`mobile-nav-tune.css` chỉ còn xuất hiện trong tài liệu kế hoạch, không phải source import.

**Không xóa ở Lô 0.** Lô 5 phải re-search trên HEAD lúc đó rồi mới xóa.

---

## 7. Component lineage / trùng thế hệ

### Active chain đã xác minh

```text
/visits
-> VisitsLocalPage
-> MCPPage
-> MCPPageEntryReportReady
-> McpSessionCompactView (wrapper)
-> McpSessionCompactViewFinal2 (active inner implementation)
```

### Ứng viên legacy/orphan cần xử lý sau parity

- `McpSessionCompactViewFinal.tsx`: không phải inner implementation active; wrapper hiện import `Final2`.
- `MCPPageEntry.tsx`: `MCPPage.tsx` hiện export `MCPPageEntryReportReady`; entry cũ là legacy candidate.
- `ReportRichSaveEnhancer.tsx`: search source chỉ thấy chính file, không có caller hiện tại.
- `features/routes/RoutesClientPage.tsx` + `RoutesPage.tsx`: app route `/routes` hiện dùng `McpRoutesLocalPage`, nên bộ route feature cũ là cleanup candidate sau khi xác minh test/deep import.
- `McpSessionsManager.tsx` **không phải orphan**: `McpSessionsManagerSafe` vẫn bọc/delegate vào lineage này; không xóa mù.
- Order chain `OrdersPage -> OrdersLocalPage -> OrdersClientPage` đang active; `OrderCreateSheet` còn caller thật.

Rule: candidate chỉ được xóa ở Lô 5 sau khi search caller + test + build trên HEAD mới nhất.

---

## 8. Mobile reference inventory

Mobile baseline đang có 5 primary destinations cố định:

```text
Hôm nay
Đi tuyến
Điểm bán
Đơn hàng
Thêm
```

Primary screen owner:

- `TodayPage`
- `RoutesPage`
- `OutletsPage`
- `OrdersPage`
- `MorePage`

`MorePage` hiện gom:

- Tuyến cố định
- Lịch sử phiên
- Báo cáo
- Kết quả thử sản phẩm
- Xuất dữ liệu
- Thiết lập báo cáo thị trường
- Kế hoạch & Công việc
- Đề xuất
- Mở hoặc liên kết mã khách
- Thiết lập
- Đăng xuất

Đây là taxonomy mục tiêu của PWA. PWA vẫn giữ capability riêng mà Mobile chưa có; capability đó phải được đặt vào nhóm phù hợp trong Thêm, không xóa.

---

## 9. Mapping gate Lô 0: PWA -> Mobile -> UI đích -> contract -> style owner

| PWA hiện tại | Mobile reference | UI đích | Contract phải giữ | Style/component owner Lô 1+ |
|---|---|---|---|---|
| Dashboard `/` | TodayPage | Hôm nay | local-read summary, route/session facts | `ui/foundation` + `TodayScreen.module.css` |
| Visits/MCP session | RoutesPage | Đi tuyến | toàn bộ session-customer mutations | `RouteWorkScreen.module.css` |
| Customers | OutletsPage | Điểm bán | outlet/core customer boundary, media, GPS, onboarding | `OutletDirectoryScreen.module.css` |
| Orders | OrdersPage | Đơn hàng | Core Sales order contract/idempotency | `OrdersScreen.module.css` |
| Menu/sidebar nghiệp vụ phụ | MorePage | Thêm | không mất route/capability | `MoreScreen.module.css` |
| Routes master | FixedRoutesPage | Tuyến cố định | route/route-customer owner | feature module riêng |
| Sessions | SessionHistoryPage | Lịch sử phiên | lifecycle/export/report snapshot | feature module riêng |
| Reports | history/report screens | Báo cáo | report/export/analyze/proposal | feature module riêng |
| Field checks | ProductTrialPage | Kết quả thử SP | field-check update | feature module riêng |
| Plans/actions | TasksPage | Kế hoạch & Công việc | follow-up/task contract | feature module riêng |
| Onboarding | CustomerOnboardingPage | Mở/liên kết mã | customer-verification idempotent contract | feature module riêng |
| Report settings | ReportSettingsPage | Thiết lập báo cáo | permission + idempotent settings | feature module riêng |
| Settings | SettingsPage | Thiết lập | PWA/device/account behavior | feature module riêng |

### Planned shared owners

Lô 1 chỉ được có một owner cho từng primitive:

```text
tokens/theme        -> ui/foundation/tokens.css
global reset/layout -> ui/foundation/base.css
App shell           -> ui/shell/McpAppShell + module CSS
Bottom navigation   -> ui/shell/McpBottomNav + module CSS
Page header         -> ui/primitives/PageHeader + module CSS
Card/list row       -> ui/primitives/Card/ListRow
Button              -> ui/primitives/Button
Input/search/filter -> ui/primitives/Input/Search/Filter
Status pill         -> ui/primitives/StatusPill
Sheet/dialog        -> ui/overlay/Sheet/Dialog
Loading/empty/error -> ui/state/*
```

Tên cụ thể có thể điều chỉnh trong Lô 1 nếu repo convention yêu cầu, nhưng **ownership một chiều không được thay đổi**.

---

## 10. Test inventory bảo vệ refactor

Repo đang có ít nhất:

- **8** test liên quan shell/mobile/navigation/PWA.
- **43** test route/session/visit.
- **30** test customer/outlet/media/GPS/onboarding.
- **20** test order/sales.
- **16** test report/field-check/proposal.
- **3** test idempotency trực tiếp.

Các contract đáng chú ý:

```text
app-shell-browser-acceptance-contract.test.mjs
mobile-dock-navigation-contract.test.mjs
mcp-mobile-primary-flows-contract.test.mjs
mcp-mobile-support-flows-contract.test.mjs
mcp-session-card-ui-contract.test.mjs
mcp-session-checkin-ui-contract.test.mjs
route-active-session-ui-contract.test.mjs
route-customer-photo-gallery-contract.test.mjs
route-customer-photo-management-contract.test.mjs
orders-create-mobile-regression.test.mjs
orders-create-ui-contract.test.mjs
phase-6c2-sales-order-contract.test.mjs
phase-6c1b-customer-onboarding-contract.test.mjs
a5-5-1-idempotency-caller-contract.test.mjs
a5-5-2-session-lifecycle-caller-contract.test.mjs
a5-5-2-route-customer-update-caller-contract.test.mjs
```

Lô 1–5 phải sửa test UI khi contract trình bày chủ động thay đổi, nhưng không được hạ test nghiệp vụ để “cho xanh”.

---

## 11. Gate Lô 0

- [x] Inventory tất cả page/route PWA.
- [x] Mapping PWA → Mobile → UI đích.
- [x] Khóa capability/nghiệp vụ phải giữ.
- [x] Khóa mutation/API quan trọng và idempotent boundary.
- [x] Khóa permission boundary.
- [x] Inventory loading/empty/error/retry.
- [x] Inventory CSS toàn bộ theo loại.
- [x] Có bằng chứng primitive đang nhiều CSS owner.
- [x] Xác định component lineage active và cleanup candidates.
- [x] Inventory test bảo vệ.
- [x] Xác định owner component/style mục tiêu cho Lô 1.

**Lô 0 PASS.**

Bước kế tiếp là **Lô 1 — dựng design foundation sạch**. Không được sửa từng màn bằng CSS override trước khi foundation có owner rõ và test shell/primitives tương ứng.
