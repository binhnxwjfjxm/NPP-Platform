# Interaction feedback và tùy chọn Phản hồi rung

> Cập nhật: **2026-07-18**  
> Phạm vi: frontend/PWA + adapter sẵn sàng cho Capacitor  
> Production release SHA: `528f7715cdc9a7186cc7f00f6af1bcdc9f6de759`

## Kiến trúc

Một lớp dùng chung sở hữu toàn bộ phản hồi tương tác:

```text
Intentional UI click
-> InteractionFeedbackProvider
-> kiểm preference trên thiết bị
-> Capacitor Plugins.Haptics nếu native
-> navigator.vibrate nếu web hỗ trợ
-> no-op an toàn nếu không hỗ trợ hoặc bị chặn
```

Không rải `navigator.vibrate()` hoặc native plugin call vào từng component.

Các mức feedback đã chuẩn hóa:

```text
selection
light
medium
success
warning
error
```

Control disabled không rung. Control có `data-interaction-feedback="none"` được loại khỏi delegated feedback. Lỗi native/web feedback không được phép làm hỏng thao tác nghiệp vụ.

## Cài đặt

Trang Cài đặt có switch accessibility:

```text
Phản hồi rung
```

- `role="switch"` và `aria-checked`.
- Mặc định bật trên thiết bị chưa có preference.
- Lưu theo thiết bị bằng key `mcp-plan:interaction-feedback-enabled`.
- Khi bật lại, phát success preview.
- Hiển thị channel hiện tại: Capacitor, web vibration hoặc visual-only fallback.

## Sửa lỗi phát hiện từ evidence

Ảnh Chromium đầu tiên cho thấy `/settings` bị AppShell đặt tên phân hệ là `Tổng quan`. Root cause là Settings chưa có metadata trong `navItemForHref()`.

Fix:

```text
SETTINGS_NAV_ITEM
-> tham gia navigation metadata lookup
-> AppShell top bar hiển thị Cài đặt ứng dụng
```

Không vá title riêng trong Settings page.

## Automated evidence

```text
PR #49:                      MERGED
Final head:                  065bb525578df3d603d3548154a51c480c97fa34
Merge SHA:                   528f7715cdc9a7186cc7f00f6af1bcdc9f6de759
Foundation F0.2 #412:        PASS
F05 UI Browser #48:          PASS
Session Actions UI #15:      PASS
Vercel production:           SUCCESS
```

Browser result:

```json
{
  "INTERACTION_FEEDBACK_BROWSER_SMOKE": "PASS",
  "settingsTopBar": "PASS",
  "webPreference": "PASS",
  "persistedSetting": "PASS",
  "capacitorPriority": "PASS"
}
```

Artifact:

```text
name:    f05-ui-browser-smoke-evidence
id:      8430775468
digest:  sha256:d8f5b0c649778eae1e23c031c06e293992f1abbaed77a90a0c3531663167eebb
image:   15-interaction-feedback-setting.png
```

## Live gate còn lại

Trên điện thoại production:

1. Mở Cài đặt và xác nhận thanh trên ghi `Cài đặt ứng dụng`.
2. Tắt Phản hồi rung, bấm menu/nút và xác nhận không rung.
3. Reload, xác nhận switch vẫn tắt.
4. Bật lại, xác nhận thiết bị hỗ trợ rung có preview nhẹ.
5. Trên thiết bị/trình duyệt không hỗ trợ rung, xác nhận mọi thao tác vẫn chạy bình thường.

Capacitor native live smoke chỉ thực hiện khi app được đóng gói. Automated test đã xác nhận native adapter được ưu tiên hơn Web Vibration fallback.

Không đổi backend, schema hoặc VPS. Không cần `pullmcp`. Không đụng port `3002`.
