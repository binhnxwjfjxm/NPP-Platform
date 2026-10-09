# Công Ty — Chính sách giá và lịch sử đơn

## Quy tắc gốc
- Khách được gán nhóm trong hồ sơ; khi chọn khách trên đơn, backend lấy nhóm khách chính thức từ hồ sơ.
- Mỗi bảng giá tự mang điều kiện theo kênh, nhóm khách, khách cụ thể hoặc tổ hợp. Các điều kiện khác null phải đồng thời khớp.
- Bảng giá CHANNEL chỉ cần đúng kênh bán; không cần gán nhóm vào kênh. Bảng CUSTOMER_GROUP có kênh thì cả kênh và nhóm phải khớp; chỉ SKU có dòng giá riêng mới được điều chỉnh.
- Giữ priority, EXCLUSIVE/STACKABLE, stop_processing, mức số lượng và thời gian hiệu lực như thiết kế gốc.
- Giá nền có sẵn làm giá khởi đầu; thiếu giá nền có thể bắt đầu từ giá cố định hợp lệ; nếu không có giá khởi đầu phù hợp thì 0 đồng, không tạo giá nền giả trong DB.
- Giá lần mua trước được tìm theo khách, SKU, đơn xác nhận và đơn vị, không dùng bảng liên kết nhóm–kênh PR #1259; thiếu lịch sử quay về giá hiện hành.

## Khôi phục đúng phạm vi
- Loại điều kiện phụ nhóm–kênh khỏi ba đường chọn bảng giá và giá lần mua trước.
- Trả riêng phần cấu hình Kênh bán về UI gốc trước PR #1259; không thay đổi màn lập đơn hay các tab khác.
- Loại API gán nhóm vào kênh; giữ nhóm khách, khách, kênh, bảng giá và dữ liệu giá nguyên trạng.
- Migration 163 là lịch sử đã áp dụng, không sửa/xóa. Migration 164 chỉ DROP bảng liên kết thừa khi trống; có dữ liệu thì dừng với lỗi, không CASCADE hoặc tự xóa dữ liệu.

## Lịch sử đơn — giữ nguyên
- Tìm tất cả đơn qua backend, không giới hạn 1.000 kết quả gần nhất.
- Phân trang và lọc đúng phạm vi kho, nhân viên, nguồn, trạng thái, hình thức giao.
- Không viết lại đơn đã xác nhận.

## Triển khai production (không thuộc PR này)
1. Kiểm tra main SHA, runtime, database migration registry, bảng và dữ liệu, backup + diễn tập restore.
2. Chỉ sau khi CI xanh và owner cho phép, merge/deploy code Công Ty, smoke giá theo kênh/nhóm, giá cũ và tìm đơn.
3. Chạy migration 164 riêng sau khi xác nhận không còn backend cũ đọc bảng, bảng trống và đủ điều kiện DB gate; không chạy trong PR.
