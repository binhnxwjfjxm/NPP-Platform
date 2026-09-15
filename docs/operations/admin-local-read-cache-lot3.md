# Admin Hưng Phát — Lô 3 local-first cho màn đọc quản trị

> Baseline: `main@5773102f17ed7e6652aaa37be3ebc08e4237bfb7`

## Phạm vi

Lô 3 áp dụng nền IndexedDB dùng chung vào ba màn đọc thường xuyên của Admin Hưng Phát:

- Tổng quan quản trị;
- Trung tâm đề xuất;
- Trung tâm cảnh báo.

Mục tiêu là mở lại dữ liệu đã xem gần như ngay lập tức trên cùng thiết bị, sau đó cập nhật nền từ hệ thống Công Ty. PostgreSQL và API Công Ty vẫn là nguồn dữ liệu chính thức.

## Cách hoạt động

- Trình duyệt đọc snapshot đã lưu trước, không chờ ba nguồn quản trị tải xong mới dựng màn hình.
- Mỗi nguồn tự cập nhật nền khi mở màn hình, mỗi 30 giây khi tab đang hiển thị và khi người dùng quay lại tab.
- Snapshot tách theo ứng dụng + installation + tài khoản + nguồn dữ liệu + phiên bản schema; cảnh báo và tổng quan còn tách theo kỳ đang xem.
- Nếu lần cập nhật mới lỗi tạm thời, màn hình tiếp tục giữ dữ liệu đã lưu và báo rõ đang dùng dữ liệu cũ.
- Nếu backend trả không có quyền, snapshot của nguồn đó bị xóa ngay thay vì tiếp tục hiển thị.
- Nếu phiên đăng nhập hết hiệu lực, người dùng được đưa về màn đăng nhập.
- Khi đăng xuất, dữ liệu local của tài khoản hiện tại được xóa trước khi kết thúc phiên; lỗi local không được phép chặn đăng xuất.

## Ranh giới nguồn sự thật

IndexedDB chỉ là bộ nhớ đọc nhanh. Các màn chi tiết và mọi thao tác quyết định/cập nhật vẫn đọc và ghi qua luồng live hiện có trước khi thay đổi nghiệp vụ. Không lưu token, mật khẩu hay credential vào snapshot.

## Hạ tầng

- Không thay đổi PostgreSQL.
- Không migration.
- Không tạo backend business authority mới.
- Admin dùng same-origin route để gọi lại các nguồn Công Ty hiện có.
- Merge source không đồng nghĩa deploy production; deploy Admin là bước riêng khi Owner yêu cầu.
