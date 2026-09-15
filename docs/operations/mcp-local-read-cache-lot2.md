# Lô 2 — MCP local-first

Phạm vi Lô 2 áp dụng nền IndexedDB dùng chung vào MCP cho các màn đọc thường xuyên: Tổng quan, Quản lý đi thị trường, Tuyến/Điểm bán và Phiên gần đây.

Luồng thực tế:

1. Xác thực phiên người dùng.
2. Đọc snapshot đã lưu theo `app + installationId + userId + resource + schemaVersion`.
3. Hiển thị snapshot ngay khi có.
4. Kiểm tra cursor ở MCP backend.
5. Chỉ tải snapshot mới khi cursor thay đổi.
6. Phiên cũ hơn cửa sổ local vẫn đọc live qua API hiện có để không mất chức năng tra cứu lịch sử.

Backend mới gom một read model MCP có giới hạn thay vì để từng màn quét độc lập nhiều bảng. Phiên gần đây được giới hạn theo ngày và số dòng; số liệu điểm bán trong phiên được tổng hợp tại PostgreSQL trước khi trả về frontend.

IndexedDB chỉ là lớp đọc nhanh. Backend + PostgreSQL vẫn là nguồn sự thật. Không mutation nào được xác nhận từ dữ liệu local. Đăng xuất xóa snapshot của tài khoản hiện tại.

Lô này không có migration và không thay cấu trúc database.
