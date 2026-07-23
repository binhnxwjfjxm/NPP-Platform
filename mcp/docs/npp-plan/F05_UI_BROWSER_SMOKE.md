# NPP-F05 — Production-build browser smoke

> Cập nhật: **2026-07-17**  
> PR: **#35**  
> Phạm vi: **Next production build + Chromium + stateful mock Gateway**  
> Trạng thái: **AUTOMATED BROWSER SMOKE PASS — LIVE VERCEL CLICK SMOKE PENDING**

## 1. Mục tiêu

Đóng repeatable UI contract bằng thao tác DOM thật, không chỉ regex source:

- tuyến không có active session lưu thẳng, không prompt;
- tuyến có đúng một active session hiện prompt hai lựa chọn;
- lựa chọn mặc định thêm vào tuyến và phiên;
- lựa chọn phụ chỉ thêm vào tuyến;
- duplicate reuse đúng logical route/session rows;
- regression **Thêm khách trong Phiên** có `Idempotency-Key` và lưu route + session;
- manual check-in chỉ lấy GPS khi click, undo không gửi lại tọa độ và không đổi `visit_status`.

## 2. Lỗi UI browser smoke bắt được

Browser run đầu xác nhận popup và hai nút đã hiện nhưng câu hỏi trong body bị trắng/ẩn.

Root cause nằm ở `src/app/mcp-popup-compact.css`:

```css
.bottom-sheet:has(.sheet-footer .sheet-action-grid > .button:nth-child(2):last-child)
  .sheet-body > .visit-sheet-content > .visit-focus-card:first-child {
  display: none;
}
```

Selector structural này được viết để ẩn card trang trí đầu tiên của action form có hai nút. Prompt route-active cũng có đúng hai nút và dùng `visit-focus-card`, nhưng card đó là toàn bộ nội dung câu hỏi nên bị ẩn.

Sửa ownership tại `src/app/mcp-popup-content-ownership.css`:

```css
.bottom-sheet:has(.sheet-footer .sheet-action-grid > .button:nth-child(2):last-child)
  .sheet-body
  > .visit-sheet-content
  > .visit-focus-card:first-child:last-child {
  display: grid;
}
```

Kết quả:

- action popup có card trang trí + working content vẫn giữ compact behavior cũ;
- decision prompt chỉ có một owned card luôn hiển thị câu hỏi;
- contract test khóa thứ tự import sau `mcp-popup-compact.css` và selector `first-child:last-child`.

Không đổi business mutation, schema, idempotency requirement hoặc Gateway ownership.

## 3. Browser cases đã PASS

```text
routeNoActive             PASS
routeActiveInclude        PASS
routeActiveRouteOnly      PASS
duplicateReuse            PASS
sessionAddCustomer        PASS
manualCheckin             PASS
F05_UI_BROWSER_SMOKE      PASS
```

Assertions gồm:

```text
preflight routeId đúng route đang chọn
active session count đúng 0 hoặc 1
primary/default button = Thêm vào tuyến và phiên
route-customer request có Idempotency-Key
includeActiveSession + activeSessionId đúng lựa chọn
route-only không tạo session snapshot
duplicate chỉ còn một logical route customer + một logical session customer
session add request có Idempotency-Key
check-in payload có GPS từ browser click
undo payload không có geoLat/geoLng
visit status giữ pending
```

## 4. CI và artifact

Browser workflow:

```text
Workflow:    F05 UI Browser Smoke
Run:         #6
Run ID:      29600091655
Conclusion:  success
Head SHA:    9c88fa80cb9d4c4c2714f81c2841e8ad0a953bce
```

Foundation workflow:

```text
Workflow:    Foundation F0.2
Run:         #338
Run ID:      29600091669
Conclusion:  success
```

Artifact:

```text
name:    f05-ui-browser-smoke-evidence
id:      8414656857
digest:  sha256:50660ac6c9cb53ba02d084b81fc6c546d6d53d721c31ba853c06299ea48d43b3
```

Artifact chứa:

```text
result.json
mock-state.json
browser-smoke.log
next.log
mock-backend.log
01-route-no-active-pass.png
02-active-session-prompt.png
03-active-session-include-pass.png
04-active-session-route-only-pass.png
05-duplicate-reuse-pass.png
06-session-add-customer-pass.png
07-manual-checkin-pass.png
08-manual-checkin-undo-pass.png
compiled Next CSS
```

## 5. Ranh giới evidence

Đây là browser smoke thật trên **Next production build**, dùng Chromium và stateful mock Gateway để kiểm UI/request contract lặp lại được, không ghi dữ liệu production.

Nó không được ghi thành live-production click smoke. Live Vercel vẫn cần:

1. deploy current `main` sau khi build-rate-limit cho phép;
2. thao tác thật trên domain production;
3. xác minh route không active, cả hai lựa chọn active route, Thêm khách trong Phiên và manual check-in.

Không đụng `milktea-backend` port `3002`.
