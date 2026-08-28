# Retail iOS printer shell

Ứng dụng iOS này là **vỏ thiết bị** cho Retail hiện hữu tại `https://retail.nguyenlieuhungphat.com`. Nó không có business backend, không lưu đơn/tồn/công nợ và không thay nguồn sự thật của Công Ty.

Mục đích duy nhất ngoài việc hiển thị Retail là cung cấp `RetailPrinterBridge` cho WebView để:

- tìm máy in LAN có raw-print Bonjour `_pdl-datastream._tcp`;
- kết nối máy in nhiệt ESC/POS bằng địa chỉ IP thủ công, mặc định cổng 9100 khi tìm tự động không thấy;
- render tiếng Việt thành ảnh raster rồi gửi ESC/POS, tránh phụ thuộc code page của từng máy;
- trả trạng thái thành công/lỗi về Retail để giao diện không báo kết nối giả.

AirPrint/IPP tiếp tục đi qua **In bằng hệ thống** của iOS; bridge không giả IPP bằng cách gửi raw ESC/POS vào cổng dịch vụ khác.

## Build

Mở `NPPRetail.xcodeproj` bằng Xcode 16 trở lên, chọn Signing Team phù hợp và chạy trên iPhone thật. Local Network permission chỉ xuất hiện khi chức năng tìm/kết nối máy in được sử dụng.

## Kiểm tra thiết bị thật

1. iPhone và máy in cùng Wi‑Fi.
2. Mở `Cài đặt -> Thiết lập in`.
3. Chọn `In Wi‑Fi trực tiếp`.
4. `Tìm máy in`; nếu không thấy, mở `Cài đặt nâng cao` và nhập IP máy in.
5. `In thử` phải ra đúng K80/K58 và tiếng Việt đọc được.
6. Lưu, đóng/mở app rồi in lại mà không chọn lại máy.
7. Tắt máy in: Retail phải báo không kết nối và cho dùng In bằng hệ thống; không đổi trạng thái đơn.

## Ranh giới

- Không đưa traffic `192.168.x.x` qua Vercel/Heroku.
- Không lưu credential máy in lên server.
- Không retry vô hạn sau khi job đã được gửi; lỗi sau thời điểm gửi được coi là trạng thái chưa chắc chắn để tránh in trùng.
- A4/A5 tiếp tục phù hợp nhất với In bằng hệ thống/AirPrint. Direct ESC/POS chỉ dùng K80/K58.
