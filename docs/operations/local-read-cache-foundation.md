# Nền dữ liệu local cho các ứng dụng nội bộ

> Trạng thái: **Lô 1 — nền dùng chung**  
> Phạm vi hiện tại: nền kỹ thuật dùng lại cho MCP và Admin; chưa nối vào màn hình production.

## 1. Mục tiêu

Các ứng dụng có thể mở nhanh bằng dữ liệu đã đọc trước đó trên máy người dùng, sau đó âm thầm hỏi backend để cập nhật dữ liệu mới.

Luồng chuẩn:

```text
Mở màn hình
-> đọc snapshot local bằng IndexedDB
-> hiển thị ngay nếu có
-> gọi backend với cursor hiện tại
-> backend trả full hoặc delta
-> cập nhật IndexedDB
-> cập nhật UI bằng dữ liệu mới
```

Backend và PostgreSQL vẫn là nguồn sự thật. IndexedDB chỉ là lớp đọc nhanh, không trở thành database nghiệp vụ thứ hai.

## 2. Ranh giới cache

Mọi bản ghi local bắt buộc tách theo:

```text
app + installationId + userId + resource + schemaVersion
```

Không dùng cache của người dùng khác, installation khác hoặc app khác.

Khi đổi người dùng trong cùng app/installation, nền cache xóa dữ liệu của người dùng trước. Khi đăng xuất, app phải gọi `clearIdentity` để xóa snapshot của người dùng hiện tại.

## 3. Dữ liệu được phép giữ local

Phù hợp:

- danh mục SKU/sản phẩm cơ bản;
- tuyến và danh sách điểm bán được phân công;
- danh mục/cấu hình ít thay đổi;
- snapshot Tổng quan;
- danh sách cảnh báo/đề xuất để hiển thị nhanh;
- phiên gần đây và các read model phục vụ điều hướng/tìm kiếm.

Không lưu local để làm nguồn quyết định nghiệp vụ:

- token, cookie, Authorization, mật khẩu, API key hoặc secret;
- quyền người dùng để thay cho kiểm tra backend;
- giá/tồn kho/công nợ live để xác nhận giao dịch;
- trạng thái chứng từ dùng để duyệt/chốt nếu chưa kiểm tra lại backend;
- payload mutation chờ gửi như một nguồn nghiệp vụ riêng.

Nền dùng chung chủ động từ chối các trường credential/secret trước khi ghi IndexedDB.

## 4. Đồng bộ

Contract delta dùng:

```text
cursor
full
upserts[]
removeIds[]
```

- Lần đầu: backend có thể trả `full=true`.
- Các lần sau: frontend gửi cursor hiện có và nhận phần thay đổi.
- `upserts` hợp nhất theo `id`.
- `removeIds` loại bản ghi không còn hợp lệ.
- Không đặt TTL để tự xóa snapshot chỉ vì đã cũ. Snapshot cũ có thể hiện trước, nhưng phải refresh nền.
- Nếu refresh lỗi, giữ snapshot trước đó; không xóa màn hình đang dùng.
- Nhiều request refresh cùng một resource trong cùng tab được gộp thành một request.

## 5. Thứ tự áp dụng

Lô 1 chỉ tạo nền dùng chung và regression test.

Lô 2 áp dụng vào MCP:

```text
Tổng quan
Tuyến
Điểm bán
Phiên gần đây
```

Đồng thời phải giảm việc quét nhiều bảng/dòng ở backend; IndexedDB không được dùng để che một API đọc quá nặng.

Lô 3 áp dụng vào Admin:

```text
Tổng quan
Cảnh báo
Đề xuất
```

Các thao tác duyệt/xử lý vẫn phải đọc lại dữ liệu live trước khi mutation.

## 6. Phạm vi hạ tầng

Lô 1:

- không thay backend;
- không thay PostgreSQL;
- không migration;
- không deploy production;
- không thay xác thực hiện tại.

Khi Lô 2/Lô 3 nối vào từng app, phải đo thời gian mở màn hình trước/sau và thêm smoke cho local-first + refresh nền.
