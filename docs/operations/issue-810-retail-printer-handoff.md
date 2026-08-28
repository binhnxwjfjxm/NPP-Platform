# Issue #810 — Retail printer bridge handoff

## Source scope

- `retail/web/**`: thiết lập máy in, routing in, fallback hệ thống và regression tests.
- `retail/mobile/ios/**`: thin iOS device shell + local printer bridge.
- Không backend nghiệp vụ mới, không migration, không thay order/inventory/payment authority.

## Quyết định đã khóa

- PWA thuần không giả kết nối raw TCP tới máy in LAN.
- PWA không có native bridge thì chỉ dùng `In bằng hệ thống`.
- iOS shell cung cấp direct ESC/POS cho K80/K58 qua raw-print Bonjour hoặc IP thủ công.
- AirPrint/A4/A5 tiếp tục dùng giao diện in của iOS.
- Printer profile/IP/copies/preview lưu trên thiết bị, không ghi database Công Ty.
- Job đã bắt đầu gửi nhưng mất xác nhận là trạng thái chưa chắc chắn: không tự fallback hoặc retry để tránh in trùng.

## Gate còn lại trước rollout

- CI exact-head phải xanh.
- Smoke iPhone thật + máy in K80/K58 thật theo checklist `docs/operations/retail-printer-device-verification.md`.
- Merge, Vercel deploy và iOS/TestFlight/App Store rollout đều là lệnh riêng của Owner.
