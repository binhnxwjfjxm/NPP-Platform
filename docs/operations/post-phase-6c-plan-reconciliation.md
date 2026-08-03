# NPP Platform — Mốc tiếp tục sau Phase 6C

Ngày đối chiếu: 2026-08-03

## Phần này làm gì

Chốt đúng tiến độ hiện tại để không quay lại làm trùng phần đơn bán hàng hoặc phần kết nối MCP với Core.

## Mốc đã kiểm tra

- Exact `main`: `7969f90da67e7b4db4f7cbe702844ab033f14aa7`.
- PR #202 đã merge: bài kiểm tra Phase 6C đọc đúng mã lỗi công khai.
- PR #215 đã merge: bổ sung đầy đủ quyền tạo và cập nhật cho MCP.
- Sửa quyền production run `30815963965`: thành công.
- Sau sửa, `POST /api/routes` và `POST /api/mcp-report-settings` không còn trả `403`; yêu cầu trống trả `400` và không tạo dữ liệu.
- PR #122 và PR #214 đã đóng không merge vì bị trạng thái hiện tại thay thế.

## Phase 6B — Đơn bán hàng

Đã có trên `main`:

- lập, lưu nháp, xác nhận, sửa và hủy đơn theo quyền;
- tìm sản phẩm, SKU và mã vạch;
- tính giá, chiết khấu, thuế và tổng tiền;
- chống tạo trùng, lưu dấu thao tác và kiểm tra tự động;
- giao diện nhập đơn cho nhân viên.

Không mở lại Phase 6B từ các PR cũ.

## Phase 6C — MCP kết nối khách hàng và đơn bán hàng Core

Đã có và đã đưa vào production:

- điểm bán MCP chỉ gửi đề nghị mở hoặc liên kết mã khách khi có nhu cầu mua hàng chính thức;
- Core xử lý đề nghị khách hàng;
- MCP tạo yêu cầu đơn chính thức khi điểm bán đã liên kết;
- MCP dùng backend và PostgreSQL đích;
- migration MCP `001–008` đã áp dụng;
- cài đặt báo cáo có dữ liệu thật;
- quyền tạo tuyến, điểm bán, phiên, check-in, nhu cầu mua, test, báo cáo, theo dõi và cài đặt báo cáo đã được khôi phục.

## Phần chức năng kế tiếp

Phase 6D biến một đơn đã xác nhận thành hàng thực tế để giao:

1. giữ hàng cho đơn;
2. chọn lô và hạn dùng;
3. xử lý giao một phần hoặc thiếu hàng;
4. tạo phiếu giao hàng;
5. trừ kho đúng thời điểm và hoàn lại khi cần;
6. giữ nguồn gốc khi khách trả hàng.

## Quyết định phải khóa trước khi làm Phase 6D

- Khi nào bắt đầu giữ hàng: lúc xác nhận đơn hay lúc kho tiếp nhận.
- Chọn lô: ưu tiên lô gần hết hạn hay cho nhân viên chọn tay.
- Thiếu hàng: chờ hàng, giao một phần hay hủy phần thiếu.
- Khi nào chính thức trừ kho: lúc xuất kho hay lúc giao thành công.
- Hàng giao thất bại hoặc khách trả lại sẽ quay về vị trí nào.

## Ranh giới

- Tài liệu này không tự mở Phase 6D.
- Không deploy, không migration và không đổi dữ liệu từ tài liệu này.
- Mọi phần mới bắt đầu từ exact `main` hiện tại, không dùng PR cũ làm nguồn sự thật.
