# NPP-F05 — Unified mobile app menu release

> Cập nhật: **2026-07-18**  
> PR chính thức: **#39**  
> Phạm vi: **một mobile app menu dùng chung + tác vụ ngữ cảnh của Phiên**  
> Trạng thái: **CODE / CI / BROWSER / PRODUCTION DEPLOY PASS — LIVE MOBILE CLICK CONFIRMATION PENDING**

## 1. Vấn đề và root cause

Màn Phiên ban đầu đặt `BC phiên / Xuất / Chốt phiên` thành một cụm fixed. PR #37 đã chuyển ba tác vụ vào menu `⋮`, nhưng vẫn giữ nút Cài đặt riêng của ứng dụng.

Kết quả vẫn có hai trigger trên mobile:

```text
Settings gear + session ⋮
```

Đây không phải lỗi khoảng cách. Root cause là hai feature cùng tự sở hữu vùng top-right. Cách đúng là AppShell sở hữu **một trigger duy nhất**, còn từng màn hình chỉ đăng ký item vào menu chung.

PR #39 supersede kiến trúc PR #37. Không được khôi phục gear hoặc session `⋮` riêng.

## 2. Kiến trúc chính thức

```text
Bottom navigation = chuyển phân hệ
Mobile ☰         = một menu dùng chung toàn app
Screen feature   = đăng ký action ngữ cảnh
Settings         = một item trong menu chung
```

Trên màn Phiên, bấm `☰` mở:

```text
Xem báo cáo phiên
Xuất dữ liệu
Chốt phiên
──────────────
Cài đặt ứng dụng
```

- `Chốt phiên` giữ destructive styling và bước xác nhận.
- `Xuất dữ liệu` mở sheet con PDF / Excel.
- Không đổi business mutation, schema, Gateway owner hoặc idempotency contract.
- Không đổi backend VPS hoặc port.

## 3. Source ownership

```text
src/ui/shell/MobileAppMenu.tsx
src/ui/shell/MobileAppMenu.module.css
src/ui/shell/AppShell.tsx
src/features/mcp/McpSessionCompactView.tsx
src/features/mcp/VisitsSessionReportPanel.tsx
src/features/mcp/VisitsSessionActionMenu.module.css
```

Đã xóa:

```text
src/ui/shell/SettingsQuickButton.tsx
```

`MobileAppMenuProvider` có một root owner. Khi gặp provider lồng nhau, nó tái sử dụng context hiện hữu thay vì render trigger mới:

```text
parent provider tồn tại -> chỉ render children
không có parent         -> render root menu + trigger ☰
```

Màn Phiên đăng ký report/export/close bằng hook; nó không render nút header riêng.

## 4. Regression contract

```text
test/session-action-menu-ui-contract.test.mjs
test/ui/f05-ui-browser-smoke.mjs
test/ui/f05-ui-session-action-menu-smoke.mjs
```

Contract khóa:

- AppShell dùng shared provider;
- chỉ một `aria-label="Mở menu ứng dụng"` trong source;
- không còn `SettingsQuickButton`;
- không còn `Mở menu tác vụ phiên`;
- session action owner nằm trong provider boundary;
- provider lồng nhau không tạo trigger thứ hai;
- report/export/close/settings cùng nằm trong menu chung;
- close giữ tone danger;
- PDF/Excel giữ canonical route;
- legacy inline `VisitsExportMenu` không quay lại.

## 5. Browser smoke

```text
viewport                      390x844
F05_UI_BROWSER_SMOKE          PASS
F05_UNIFIED_MOBILE_MENU_SMOKE PASS
triggerCount                  1
standaloneSettingsButton      false
standaloneSessionButton       false
actions                       report / export / close / settings
exportLinks                   PASS
```

Browser xác minh trước khi mở menu:

```text
chỉ đúng một nút Mở menu ứng dụng
không có button Cài đặt riêng
không có button Mở menu tác vụ phiên
không có button trong PageHeader action slot
trigger nằm trọn trong viewport mobile
```

Sau đó browser mở menu, xác minh bốn item, destructive close class, mở export sheet và kiểm href PDF/Excel.

Ảnh evidence:

```text
12-unified-menu-trigger-mobile.png
13-unified-app-menu-mobile.png
14-unified-export-menu-mobile.png
```

## 6. Lỗi browser bắt trong quá trình sửa

### 6.1 Provider boundary

Lượt đầu, `VisitsSessionReportPanel` đăng ký action khi đứng ngoài provider và trang Phiên crash:

```text
useRegisterMobileAppMenu must be used inside MobileAppMenuProvider
```

Fix đúng logic:

```text
McpSessionCompactView bọc action owner trong provider
AppShell lồng bên trong tái sử dụng provider parent
=> một context + một trigger
```

Không thêm provider thứ hai độc lập và không catch lỗi để che crash.

### 6.2 Dedicated regression còn contract cũ

Lượt tiếp theo, smoke tổng đã PASS nhưng script chuyên dụng vẫn tìm hai nút cũ. Script được chuyển sang assert một trigger và bốn menu item; gate không bị xóa hoặc nới lỏng.

## 7. CI và artifact

```text
PR:                  #39 — MERGED
Final head:          6b571cd904703603db946a63e8ed53079e6a56e6
Merge SHA:           72ab29e37f55d94545c80de0cb91b48ad1fdc543
Foundation workflow: Foundation F0.2 #355 — PASS
Foundation run ID:   29627650211
Browser workflow:    F05 UI Browser Smoke #16 — PASS
Browser run ID:      29627650225
```

Artifact:

```text
name:    f05-ui-browser-smoke-evidence
id:      8424388479
digest:  sha256:a0e4766310a18d77f3eff84a281baada45abfe141f30ad69c14a0d45797bce8f
```

## 8. Production deploy

GitHub commit status cho merge SHA:

```text
context: Vercel
state:   success
```

Frontend current main đã deploy. Không cần `pullmcp`, vì PR #39 không thay backend runtime, Supabase schema hoặc process ports.

## 9. Gate còn lại

Automated production-build browser smoke không thay cho thao tác live trên thiết bị thật. Trước A5.5.2 cần xác nhận trên mobile production:

1. chỉ có một nút `☰`;
2. không còn gear và session `⋮` riêng;
3. menu có report/export/close/settings;
4. PDF/Excel mở đúng;
5. chốt phiên vẫn xác nhận trước mutation;
6. hoàn tất các live F05 route/customer/check-in cases còn lại.

Không đụng `milktea-backend` port `3002`.
