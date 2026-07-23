# NPP-08 — Plan module Báo cáo

> Trạng thái: **PLANNED**  
> Phụ thuộc: Contract nguồn nghiệp vụ và từ điển KPI đã khóa  
> Tích hợp: Dashboard, export, snapshot, AI/ADK sau này

## 1. Mục tiêu

Cung cấp báo cáo nhất quán, truy vết được và tái tạo được từ nguồn nghiệp vụ.

Báo cáo phải trả lời:

```text
Số này lấy từ đâu?
Theo ngày/trạng thái nào?
Có bao gồm hủy/trả/thuế/chiết khấu không?
Dữ liệu chốt đến thời điểm nào?
Có drill-down được về chứng từ gốc không?
```

## 2. Nhóm báo cáo

```text
Bán hàng và đơn hàng
Giao hàng và tỷ lệ phục vụ
Tồn kho và luân chuyển
Công nợ và thu tiền
Khách hàng và độ phủ
Nhân viên và hiệu suất
MCP/thị trường
Kế hoạch và hành động
Đối soát/chất lượng dữ liệu
```

## 3. Không tự định nghĩa lại nghiệp vụ

- Doanh số đặt hàng đọc từ order contract.
- Doanh số thực giao đọc từ delivery/fulfillment contract.
- Return/credit đọc từ chứng từ điều chỉnh.
- Tồn đọc từ inventory ledger/read model.
- Công nợ đọc từ receivable ledger.
- Hiệu suất nhân viên dùng metric code/version đã khóa.

Không viết mỗi báo cáo một câu SQL khác nhau dẫn tới cùng tên KPI nhưng khác số.

## 4. Metric dictionary

Cần một từ điển metric versioned:

```text
metric_code
name
description
source domain
date basis
filters
formula
sign convention
currency/unit
version
effective_from/to
owner
```

Ví dụ phải tách:

```text
sales_order_confirmed_amount
sales_delivered_amount
cash_collected_amount
net_sales_after_returns
```

Không dùng một nhãn “Doanh số” cho bốn loại số.

## 5. Snapshot và as-of

Báo cáo định kỳ/chốt phải lưu:

```text
report_type
period
filters/scope
metric_version
source_cutoff/as_of
generated_at/generated_by
payload/checksum
status
```

Snapshot không thay nguồn sự thật nhưng dùng để bảo toàn bản đã gửi/duyệt.

## 6. Data quality và reconciliation

Bắt buộc có báo cáo kiểm tra:

```text
Order total lệch tổng dòng
Giao vượt đơn
Return vượt lượng đã nhận
Inventory balance lệch ledger
Receivable balance lệch transaction
Payment allocation vượt payment
Orphan source reference
Unknown/legacy status
```

Sai lệch phải có queue xử lý, không chỉ log kỹ thuật.

## 7. API dự kiến

```text
GET  /api/reports/catalog
POST /api/reports/run
POST /api/reports/export
GET  /api/reports/jobs/:id
POST /api/reports/snapshots
GET  /api/reports/snapshots
GET  /api/reports/reconciliation
```

Report request phải chứa metric/report version và filter chuẩn hóa.

## 8. Export

Hỗ trợ theo nhu cầu:

```text
CSV
XLSX
PDF bản trình bày
JSON cho tích hợp
```

Yêu cầu:

- export cùng filter và số với màn hình;
- có thời điểm dữ liệu;
- tên cột tiếng Việt rõ ràng;
- số tiền/số lượng không mất precision;
- file lớn chạy job, không khóa request dài;
- export theo permission, không lộ cột nhạy cảm.

## 9. AI/ADK

AI chỉ đọc context/report snapshot đã lọc và có schema. Không cho AI query DB tùy ý hoặc tạo số không truy vết.

AI có thể:

- tóm tắt biến động;
- nêu bất thường;
- gợi ý câu hỏi/việc cần làm;
- tạo bản trình bày từ metric có nguồn.

AI không được tự sửa transaction hoặc đóng sổ.

## 10. UI

```text
Danh mục báo cáo
Filter chuẩn dùng chung
Kết quả bảng/biểu đồ
Drill-down
Lịch sử chạy/snapshot
Export
Báo cáo đã ghim
Đối soát dữ liệu
```

Không mặc định nhồi nhiều biểu đồ. Ưu tiên câu hỏi nghiệp vụ và hành động.

## 11. Permission

- Báo cáo tuân theo data scope nguồn.
- Giá vốn/lợi nhuận/công nợ có quyền riêng.
- Export là quyền riêng, không mặc định theo quyền xem.
- Snapshot đã duyệt có quyền sửa/hủy riêng.
- Mọi lần export dữ liệu nhạy cảm cần audit.

## 12. Test matrix

```text
[ ] cùng metric/filter cho cùng kết quả ở dashboard/report/export
[ ] return/hủy/credit áp dụng dấu đúng
[ ] timezone và period boundary đúng
[ ] snapshot giữ metric version/as-of
[ ] drill-down tổng bằng headline
[ ] export không mất decimal/Unicode
[ ] permission/export không rò dữ liệu
[ ] reconciliation phát hiện dữ liệu cố tình làm lệch
```

## 13. Checklist

```text
[ ] R-01 Audit reports/API/export hiện có
[ ] R-02 Lập metric dictionary
[ ] R-03 Chốt date basis/sign/rounding
[ ] R-04 Thiết kế report catalog/filter schema
[ ] R-05 Thiết kế snapshot/job/export
[ ] R-06 Reconciliation suite
[ ] R-07 Backend APIs/read models
[ ] R-08 UI + export
[ ] R-09 Permission/performance tests
[ ] R-10 Production smoke/freeze metric v1
```

## 14. Open questions

```text
[ ] Báo cáo quản trị cần chốt theo ngày giao, hóa đơn hay thu tiền?
[ ] Có báo cáo gửi tự động theo lịch không?
[ ] Giá vốn và lợi nhuận đã có nguồn đáng tin chưa?
[ ] Snapshot nào cần duyệt/khóa pháp lý?
```
