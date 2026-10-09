# Công Ty — Chính sách giá theo nhóm thực tế và tìm kiếm lịch sử đơn

## Số liệu audit production chỉ đọc — 2026-10-09 07:00 UTC
- `PR-GT` / Kênh `GT` / Bản Giá Đại Lý: **1.949** dòng giá đang hoạt động; **1.415** còn hiệu lực tại thời điểm audit.
- `HORECA` / Kênh `HORECA` / Giá Kênh Quán: **219** dòng đang hoạt động; **199** còn hiệu lực.
- Cả hai là bảng `CHANNEL`. Lúc audit cả hai **không có liên kết nhóm-kênh** theo migration 163.
- Chưa xác minh mã hoặc ID của **nhóm khách Đại Lý thực tế** trong production. Không suy đoán nhóm từ chữ `GT`, mã kênh hoặc tên bảng.

## Thiết kế gốc — không thêm logic hoặc UI
- Khách đã có nhóm chính thức `shared.customers.group_id`. Khi chọn khách trên đơn, backend lấy nhóm từ hồ sơ; không tin nhóm do frontend tự gửi.
- `CHANNEL`: bảng giá chung theo một kênh (ví dụ bảng Giá Kênh Quán nếu chính sách muốn áp dụng chung).
- `CUSTOMER_GROUP`: bảng giá cho một nhóm khách, **có thể đồng thời giới hạn kênh**. Chỉ đúng nhóm và đúng kênh mới được hưởng giá.
- Giá nền làm mặc định. Nếu thiếu nền mà có giá cố định hợp lệ trong bảng theo đúng phạm vi thì lấy giá đó; nếu không có giá phù hợp thì **0đ**, không tạo dòng giá nền 0đ.
- Giữ nguyên giá theo khách, theo nhóm, khuyến mãi, giá mua trước, mức ưu tiên, EXCLUSIVE/STACKABLE, stop_processing, thời gian, số lượng và từng SKU riêng.

## Điều chỉnh Bảng Giá Đại Lý — đúng phạm vi, giữ nguyên toàn bộ dòng giá
- Vấn đề thực tế: `PR-GT` đang là `CHANNEL`; nếu chỉ chọn Kênh Đại Lý, một khách KHTV vẫn có thể được giá Đại Lý.
- Cách sửa: chuyển **chính bản ghi bảng giá hiện hữu** từ `CHANNEL` sang `CUSTOMER_GROUP`, với `customer_group_id` xác minh là nhóm Đại Lý và **giữ nguyên channel_id = GT**.
- Bảng giá vẫn cùng ID, mã, tên, độ ưu tiên; **không tạo bảng mới, không copy/đổi/xóa bất kỳ dòng giá sản phẩm nào**.
- SQL chuẩn cho thao tác chuyển có kiểm soát: `database/operations/price-list-channel-to-customer-group.sql`. Đây là **data correction theo quy trình migration**, không đăng ký trong auto-migrations.
- SQL đòi hỏi `installation_id`, mã bảng giá, mã kênh, mã nhóm **đã xác minh trực tiếp**, số dòng giá đang hoạt động dự kiến, actor ID và request ID. Sai mã nhóm, kênh, loại giá hoặc tổng dòng thì dừng toàn bộ transaction.
- SQL ghi audit, chạy lại với đúng điều kiện là no-op. Không sửa dữ liệu đơn đã xác nhận. Không được chỉnh database production thủ công.
- Chỉ áp dụng cho bảng có chính sách **giới hạn nhóm** được owner xác nhận. **Không chuyển đồng loạt** bảng Kênh Quán hay các bảng kênh chung.

## Kiểm thử đã thêm
- Giá nền 624.000đ và giá Đại Lý 610.000đ: khách Đại Lý ở Kênh Đại Lý = 610.000đ; KHTV chọn nhầm Kênh Đại Lý = 624.000đ.
- SKU không có giá nền: Đại Lý đúng nhóm/kênh vẫn 610.000đ; KHTV chọn nhầm = 0đ.
- Sai mã nhóm hoặc số lượng dòng giá => rollback, không đổi bản giá.
- Chuyển tại chỗ phải giữ ID bảng, ID từng dòng giá, tiền và ưu tiên; chạy lại không ghi audit lặp.
- Client cung cấp nhóm sai khi đã chọn khách => bị từ chối.

## Quy trình production — gate riêng, PR không thực hiện
1. Audit production mới: đối chiếu `PR-GT`, kênh `GT`, tất cả nhóm khách thật, mã và ID nhóm Đại Lý, các bảng giá khác cùng kênh, số dòng và giá theo SKU. Chưa được tự coi nhóm nào là Đại Lý.
2. Kiểm tra backup, phục hồi diễn tập, ghi các chỉ số trước/sau và xác nhận quyền chạy migration bởi owner.
3. Thực hiện SQL đã lưu trong repo qua **quy trình migration được phê duyệt**, trong một transaction với thông số đối chiếu. Kiểm tra số dòng, ID, đơn giá, audit, kết quả tính giá cả khách đúng/sai nhóm/kênh.
4. Chỉ sau đó mới được bật phiên bản backend sử dụng điều kiện chính thức. Migration 163 giữ nguyên lịch sử; migration 164 chỉ gỡ bảng phụ khi bảng trống và không có backend cũ sử dụng. Có dữ liệu => dừng, không CASCADE.
5. Merge, deploy frontend/backend, chạy migration production chỉ khi owner có lệnh riêng. CI xanh không có nghĩa production đã chuyển dữ liệu.

## Tra cứu Đơn bán hàng — giữ nguyên từ PR #1259
- Backend tìm toàn bộ lịch sử, bao gồm mã số đơn rút gọn, mã và tên khách (kể cả `1992 Tân Phước`), phân trang và thống kê tổng theo bộ lọc.
- Giữ phạm vi kho, phân quyền nhân viên, nguồn đơn, cách giao và trạng thái. UI loại kết quả truy vấn cũ và sắp xếp theo ngày tạo.
- Đơn `SO000071` và tổng số đơn của khách `1992 Tân Phước` vẫn phải đối chiếu database production theo quyền, không giả định đủ 5 đơn.
