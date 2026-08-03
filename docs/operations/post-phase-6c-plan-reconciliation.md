# NPP Platform — Đối chiếu kế hoạch sau Phase 6C

Ngày đối chiếu: 2026-08-03

## Mục đích

Cập nhật mốc điều hành theo trạng thái thật của `main`, tránh mở lại công việc đã hoàn thành hoặc dùng các PR cũ làm nguồn sự thật.

## Mốc mã nguồn đã kiểm tra

- `main`: `b8e643e07b55cb2168c018737bfd9619e1d282bd`
- PR #210: đã merge phần MCP report settings.
- PR #202: đã merge phần sửa bài kiểm tra mã lỗi Phase 6C.

## Trạng thái thực tế

### Phase 6B — Đơn bán hàng

Nguồn mã hiện tại đã có:

- lập, lưu nháp và xác nhận đơn bán hàng;
- tìm sản phẩm/SKU/mã vạch;
- tính giá, chiết khấu, thuế và tổng tiền;
- kiểm tra quyền, chống tạo trùng và lưu dấu thao tác;
- giao diện nhập đơn vận hành;
- các kiểm tra tự động liên quan.

PR #122 là nhánh cũ, đã tách khỏi `main` rất xa và nội dung cần thiết đã được đưa vào `main` cùng các phần hoàn thiện sau đó. Không merge PR #122.

### Phase 6C — Kết nối MCP với khách hàng và đơn bán hàng Core

Đã hoàn thành và xác minh:

- điểm bán MCP chỉ gửi đề nghị mở hoặc liên kết mã khách khi phát sinh nhu cầu chính thức;
- Core xử lý đề nghị khách hàng chính thức;
- MCP gửi yêu cầu tạo đơn chính thức sang Core khi điểm bán đã liên kết;
- MCP dùng PostgreSQL đích và các migration `001–008` đã được áp dụng production;
- report settings đã có dữ liệu thật;
- các đường đọc production và mã lỗi công khai đã được kiểm tra.

## Việc không mở

- Không tự mở Phase 6D.
- Không merge lại PR cũ đã bị `main` thay thế.
- Không deploy hoặc chạy migration production từ tài liệu đối chiếu này.

## Phần chức năng kế tiếp khi owner cho phép

Phase 6D giúp nhân viên xử lý một đơn đã xác nhận thành hàng thực tế để giao:

1. giữ đúng lượng hàng cho đơn;
2. chọn lô và hạn dùng phù hợp;
3. cho phép giao một phần và giữ phần còn lại;
4. tạo phiếu giao hàng;
5. trừ kho đúng lúc và có đường hoàn lại khi thao tác sai;
6. lưu nguồn gốc khi khách trả hàng.

Trước khi làm phải khóa rõ:

- lúc nào hàng được giữ cho đơn;
- ưu tiên lô gần hết hạn hay cho chọn tay;
- thiếu hàng thì chờ, giao một phần hay hủy phần thiếu;
- lúc nào mới chính thức trừ kho;
- hàng giao thất bại hoặc trả lại đi về đâu.

## Mốc tiếp tục

Từ mốc này:

- coi Phase 6B và Phase 6C là đã hoàn thành theo trạng thái nêu trên;
- mọi phần tiếp theo bắt đầu từ `main` hiện tại;
- chỉ mở Phase 6D khi owner ra lệnh rõ và chốt các lựa chọn nghiệp vụ còn thiếu.
