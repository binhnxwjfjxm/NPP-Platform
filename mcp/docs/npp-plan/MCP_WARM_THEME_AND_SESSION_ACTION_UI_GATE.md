# MCP warm theme foundation và session-action UI gate

> Cập nhật: **2026-07-18**  
> Phạm vi: **Bước 1–2 trước khi mở rộng AppShell/menu**  
> Trạng thái: **MERGED + VERCEL SUCCESS — LIVE PHONE ACTION SMOKE PENDING**

## Release

```text
PR:                         #44
Final head:                 8d64301f63e43c7be36526b9700d011f044e32e7
Merge SHA:                  86bc600be9fe4bb33d437121627692a3172a9a9a
Foundation F0.2:            #394 PASS
F05 UI Browser Smoke:       #38 PASS
Session Actions UI Smoke:   #5 PASS
Vercel production:          SUCCESS
Backend/schema change:      NONE
VPS pullmcp:                NOT REQUIRED
```

## Root cause UI action gate

Backend order/test/report/follow-up đã có typed owner và production runtime PASS, nhưng caller UI còn dùng alias/đường dẫn frontend cũ trong khi `mutationOperation()` chỉ nhận đường dẫn khác. Vì operation được resolve trước `fetch`, thao tác có thể dừng tại client với `unsupported_mutation_operation` và không gửi request.

Fix khóa bốn caller vào cùng canonical frontend proxy:

```text
/api/backend/mcp-day/session-customer/order
/api/backend/mcp-day/session-customer/test
/api/backend/mcp-day/session-customer/report
/api/backend/mcp-day/session-customer/followup
```

Canonical provider error dạng object cũng được map về `error.message` thay vì hiển thị `[object Object]` hoặc rơi về thông báo chung.

## Browser gate

Chromium chạy trên Next production build, click thật bốn action từ màn Phiên và kiểm stateful mock:

```text
MCP_SESSION_ACTION_UI_SMOKE  PASS
actions                      order / test / report / followup
Idempotency-Key              PASS cho cả bốn request
sessionCustomerId            sc-existing cho cả bốn request
aggregate count              order 1 / test 1 / report 1 / followup 1
```

Artifact:

```text
name:    mcp-session-actions-browser-evidence
id:      8430119462
digest:  sha256:ad0afb3a69ee1aca22f0ca8ef4b923efca4dd99d758e36979548ae6f49a7f49f
```

Automated browser evidence không ghi thay cho thao tác dữ liệu production trên điện thoại thật.

## Warm theme foundation

Palette dùng mô hình lai:

```text
app canvas       #F7F3ED  kem nhẹ
card/table       #FFFFFF  trắng
surface soft     #FBF8F4
header/sidebar   #5A3A24  nâu
primary          #4F7A3A  xanh olive
accent           #C89B5B  vàng đất
text             #2B211B
border           #E8DED2
```

Tất cả màu nằm trong `src/app/npp-theme.css`, sau đó map về alias hiện hữu (`--bg`, `--panel`, `--brand`...). Không rải hex mới theo từng màn hình. Theme được import cuối để làm lớp ownership duy nhất trong giai đoạn chuyển đổi; browser/PWA theme color dùng màu nâu header.

## Chưa nằm trong slice

- Chưa mở rộng inventory của menu ☰.
- Chưa đổi từng component đặc thù bằng CSS riêng.
- Chưa thêm haptic/rung.
- Không đổi backend/schema.

## Gate còn lại

Trên mobile production, tạo một dữ liệu hợp lệ cho từng thao tác order/test/report/follow-up và xác nhận không còn `unsupported_mutation_operation`, `idempotency_key_required` hoặc lỗi 400 do caller. Sau khi ghi live evidence mới bắt đầu slice A5.5.2 kế tiếp.
