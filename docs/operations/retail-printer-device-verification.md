# Retail direct-printer verification checklist

Issue: #810

## Web/PWA

- `In bằng hệ thống` tiếp tục hoạt động khi không có native bridge.
- `In Wi‑Fi trực tiếp` chỉ bật khi thiết bị báo capability thật.
- Cấu hình máy in lưu trong `localStorage` của thiết bị, không gửi lên API Công Ty.
- Direct thermal chỉ cho 80 mm/58 mm; A4/A5 dùng luồng hệ thống/AirPrint.
- Số bản in giới hạn 1–5 và chỉ áp dụng cho direct print.
- Tắt `Xem trước trước khi in` chỉ bypass preview khi direct printer đã được lưu.
- Lỗi trước khi gửi job có thể fallback hệ thống; lỗi sau khi bắt đầu gửi phải báo trạng thái chưa chắc chắn và không tự in lại.

## iPhone thật + máy in thật

1. Cài/run `retail/mobile/ios/NPPRetail.xcodeproj` trên iPhone thật.
2. Đăng nhập Retail và xác nhận luồng đơn hiện hữu vẫn hoạt động.
3. Cùng Wi‑Fi với máy in nhiệt.
4. `Cài đặt -> Thiết lập in -> In Wi‑Fi trực tiếp`.
5. Cho phép Local Network khi iOS hỏi.
6. `Tìm máy in`; nếu máy không quảng bá raw-print Bonjour thì nhập IP ở `Cài đặt nâng cao`.
7. Chọn K80 hoặc K58, `In thử`.
8. Xác nhận tiếng Việt đọc đúng, không cắt SKU/SL/ĐVT/đơn giá/thành tiền.
9. Lưu, tắt/mở app, in lại mà không chọn máy lại.
10. Tắt nguồn máy in rồi bấm In: phải báo không kết nối; không đổi order/stock/payment state.
11. Sau khi job đã bắt đầu gửi, tạo tình huống mất mạng: UI phải yêu cầu kiểm tra phiếu trước khi in lại, không tự fallback gây in trùng.

## Production boundary

Merge source không phải deploy. Vercel Retail và iOS/TestFlight/App Store là hai rollout riêng; không thực hiện nếu chưa có lệnh Owner.
