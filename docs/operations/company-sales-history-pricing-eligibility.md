# Công Ty — Đơn bán hàng và chính sách giá theo nhóm khách

## Quy tắc đã chốt
- Chỉ khách thuộc nhóm được gán trực tiếp với kênh mới được hưởng chính sách giá của kênh đó.
- Có giá nền và không có giá hợp lệ khác: dùng giá nền.
- Chưa có giá nền và không có giá hợp lệ khác: dùng 0 VND (không tự tạo dòng giá nền trong DB).
- Không có giá nền, có giá đặt trực tiếp ở kênh đủ điều kiện: dùng giá kênh.
- Giá riêng đúng khách/nhóm và khuyến mãi hợp lệ vẫn xét đúng phạm vi.
- Giá lần mua trước là luồng riêng; khi thiếu lịch sử thì quay về giá hiện hành đã kiểm tra quyền hưởng giá.

## Phân quyền kênh
`shared.sales_channel_customer_groups` là quan hệ rõ ràng giữa kênh bán và nhóm khách.
Quản trị viên vào phần Kênh bán để tích nhóm được phép hưởng giá.
Không tự đồng nhất mã kênh và mã nhóm, không backfill đoán mò.
Không chuyển giá lịch sử của đơn đã xác nhận.

## Lịch sử đơn
Danh sách tìm kiếm từ backend theo tất cả thời gian, không tìm trong 1000 dòng cache.
Tìm kiếm, nguồn, hình thức giao và trạng thái áp dụng ở backend rồi phân trang.
Thống kê dùng cùng phạm vi tìm kiếm/nguồn/hình thức giao và phạm vi kho/nhân viên.
Tìm mã khách 1992 Tân Phước và SO000071 phải đối chiếu thực tế trên database chỉ đọc;
không mặc định số lượng 5 đơn là sự thật của mọi tài khoản phân quyền.

## Gate triển khai production (không nằm trong lô source)
1. Audit live runtime, exact main SHA, backup và restore rehearsal.
2. Kiểm tra và chạy migration 163 riêng theo procedure DB đã khóa.
3. Đối chiếu nhóm khách thật và gán nhóm được hưởng giá cho từng kênh trước khi chuyển backend.
4. Reconcile giá trước/sau trên mẫu khách đại lý, thân thiết, khách không nhóm và khách có giá riêng.
5. Deploy Công Ty độc lập, smoke giá 0, giá kênh, tìm đơn cũ; MCP độc lập không deploy.

Chỉ triển khai sau khi owner yêu cầu rõ.