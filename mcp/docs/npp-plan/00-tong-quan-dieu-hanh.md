# NPP-00 — Plan Tổng quan điều hành

> Trạng thái: **PLANNED**  
> Vai trò: Read model điều hành, không phải nguồn ghi nghiệp vụ  
> Phụ thuộc: Đơn hàng, kho, công nợ, khách hàng, nhân viên, MCP

## 1. Mục tiêu

Cung cấp một màn hình giúp chủ NPP nhìn nhanh:

```text
Hôm nay đang bán được gì?
Đơn nào đang nghẽn?
Kho nào sắp thiếu hoặc tồn lâu?
Khách nào đang nợ/quá hạn?
Nhân viên/tuyến nào cần xử lý?
Việc nào cần ưu tiên ngay?
```

Dashboard không được tự tạo một bộ công thức riêng khác với báo cáo nghiệp vụ.

## 2. Phạm vi

- KPI doanh số, đơn hàng, giao hàng, tồn kho, công nợ.
- Cảnh báo và danh sách cần hành động.
- So sánh ngày/tuần/tháng/kỳ trước.
- Drill-down về đúng module nguồn.
- Phân quyền theo NPP, chi nhánh, kho, khu vực, nhân viên.

Ngoài phạm vi ban đầu:

- BI tùy biến hoàn toàn.
- Forecast AI khi nguồn dữ liệu chưa ổn định.
- Dashboard kế toán tổng hợp.

## 3. Nguồn sự thật

```text
orders/order_items                  -> giá trị đặt hàng
fulfillments/deliveries             -> giá trị thực giao
inventory ledger/read model         -> tồn và biến động
receivable/payment ledger           -> phải thu và thu tiền
customers                           -> khách active/risk/coverage
employees/assignments               -> người chịu trách nhiệm
mcp sessions/visits                 -> hoạt động thị trường
plans/actions                       -> việc cần làm
```

Không lấy `order_status` để thay cho số thực giao hoặc số đã thu.

## 4. KPI lõi

### Bán hàng

```text
Doanh số đơn xác nhận
Doanh số đã giao
Số đơn mới
Giá trị đơn trung bình
Tỷ lệ hủy
Tỷ lệ giao đủ
Đơn giao thiếu/backorder
```

### Kho

```text
Giá trị tồn
SKU dưới mức tối thiểu
SKU hết hàng
Tồn lâu/chậm luân chuyển
Hàng cận date/hết hạn nếu có lô
Chênh lệch kiểm kê chưa xử lý
```

### Công nợ

```text
Tổng phải thu
Đã thu kỳ này
Quá hạn
Khách vượt hạn mức
Tuổi nợ theo bucket
Khoản thu chưa phân bổ
```

### Thị trường và nhân viên

```text
Tuyến/phiên hoàn thành
Khách đã ghé/chưa ghé
Tỷ lệ chuyển đổi ghé -> đơn
Follow-up quá hạn
Nhân viên có đơn/giao/thu bất thường
```

## 5. Read model

Không query chắp vá hàng chục bảng trực tiếp từ mỗi card. Thiết kế:

```text
dashboard_daily_metrics
dashboard_alerts
dashboard_employee_metrics
dashboard_customer_risk
```

Hoặc materialized/read model tương đương có thể rebuild từ nguồn sự thật.

Yêu cầu:

- Có `as_of`/`receivedAt`.
- Biết dữ liệu cập nhật đến đâu.
- Có job rebuild và kiểm tra lệch tổng.
- Card và drill-down dùng cùng định nghĩa metric.

## 6. API dự kiến

```text
GET /api/dashboard/summary
GET /api/dashboard/overview
GET /api/dashboard/alerts
GET /api/dashboard/sales
GET /api/dashboard/inventory
GET /api/dashboard/receivables
GET /api/dashboard/team
```

Response chuẩn:

```json
{
  "data": {},
  "receivedAt": "...",
  "asOf": "...",
  "filters": {}
}
```

## 7. UI

Một màn hình desktop không cuộn quá dài; mobile ưu tiên thứ tự:

```text
1. Cảnh báo cần xử lý
2. Doanh số/giao hàng
3. Công nợ
4. Kho
5. Hoạt động đội ngũ/MCP
```

Mỗi card phải:

- có mốc thời gian;
- có so sánh kỳ;
- click được về danh sách đã filter;
- không hiển thị KPI không giải thích được;
- không dùng màu là tín hiệu duy nhất.

## 8. Permission

- Chủ NPP: toàn bộ phạm vi được cấp.
- Quản lý chi nhánh: chi nhánh/kho/khu vực của mình.
- Sales: khách/đơn/tuyến được phân công.
- Kho: KPI kho/giao liên quan.
- Kế toán: công nợ/thu tiền.
- Không trả dữ liệu nhạy cảm rồi chỉ ẩn bằng UI.

## 9. Test

```text
[ ] Tổng doanh số card = tổng drill-down cùng filter
[ ] Doanh số đặt hàng khác doanh số thực giao được hiển thị rõ
[ ] Hủy/return/credit note phản ánh đúng
[ ] Timezone Asia/Ho_Chi_Minh không lệch ngày
[ ] Filter chi nhánh/kho/nhân viên không rò dữ liệu
[ ] Read model rebuild ra cùng kết quả nguồn
[ ] Dữ liệu stale có cảnh báo as-of
```

## 10. Checklist

```text
[ ] D-01 Audit dashboard/API hiện có
[ ] D-02 Chốt từ điển KPI
[ ] D-03 Chốt filter và data scope
[ ] D-04 Thiết kế read model
[ ] D-05 Viết reconciliation query/test
[ ] D-06 Backend API
[ ] D-07 UI compact + drill-down
[ ] D-08 Permission tests
[ ] D-09 Production smoke
[ ] D-10 Freeze metric contract v1
```

## 11. Open questions

```text
[ ] KPI mặc định là theo ngày giao, ngày xác nhận hay ngày hóa đơn?
[ ] Doanh số có bao gồm VAT/chiết khấu/phí giao hàng không?
[ ] Return ghi âm vào kỳ hiện tại hay kỳ đơn gốc trong từng báo cáo?
[ ] Mức tồn tối thiểu do ai cấu hình và theo kho hay toàn NPP?
```
