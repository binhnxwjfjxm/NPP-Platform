# NPP-01 — Plan module Khách hàng

> Trạng thái: **PLANNED**  
> Phụ thuộc: Identity/permission, địa bàn/nhân viên tối thiểu  
> Tích hợp: MCP route customers, đơn hàng, công nợ, kế hoạch

## 1. Mục tiêu

Xây dựng customer master duy nhất cho toàn App NPP, tránh mỗi module giữ một bản khách riêng không đồng bộ.

Khách hàng phải hỗ trợ:

```text
Thông tin pháp lý/liên hệ
Nhiều địa chỉ giao hàng
Kênh/loại khách/khu vực
Nhân viên phụ trách
Tuyến MCP
Bảng giá/chính sách bán
Hạn mức và điều khoản công nợ
Trạng thái hoạt động/rủi ro
Lịch sử giao dịch và chăm sóc
```

## 2. Nguồn sự thật và snapshot

```text
customers/customer_details = master hiện tại
customer_addresses          = địa chỉ hiện tại
customer_assignments        = phân công hiện tại
mcp_route_customers         = membership của tuyến
order customer snapshot     = thông tin khách tại thời điểm xác nhận đơn
```

Sửa tên/địa chỉ khách master không được âm thầm làm thay đổi chứng từ lịch sử. Đơn, giao hàng và công nợ phải giữ snapshot cần thiết.

## 3. Data model tối thiểu

```text
customers
customer_contacts
customer_addresses
customer_tags
customer_assignments
customer_credit_profiles
customer_status_history
customer_merge_history
```

Trường lõi:

```text
code
name
legal_name
tax_code
phone/email
channel/type
area/territory
status: lead | active | suspended | inactive
risk_status
credit_limit
payment_terms
price_list_id
owner_employee_id
```

## 4. Duplicate và hợp nhất khách

Không dựa một mình vào tên. Dò trùng theo tổ hợp:

```text
normalized phone
tax code
địa chỉ chuẩn hóa
external/source id
business registration
```

Merge phải:

- chọn bản master giữ lại;
- chuyển assignment/tag/address hợp lệ;
- không sửa khóa tham chiếu lịch sử bằng thao tác nguy hiểm;
- giữ redirect/merge history;
- chạy trong transaction;
- có preview trước khi áp dụng.

## 5. Trạng thái và xóa

- Không hard-delete khách đã có đơn, giao, công nợ, MCP visit hoặc báo cáo.
- `suspended`: chặn tạo/xác nhận đơn mới theo policy nhưng vẫn xem và thu nợ.
- `inactive`: không còn hoạt động, vẫn giữ lịch sử.
- Thay đổi trạng thái phải có lý do và audit.

## 6. Liên kết MCP

- `mcp_route_customers` chỉ thể hiện khách thuộc tuyến nào.
- Mở session vẫn snapshot khách theo contract MCP v1.
- Sửa master khách không mutate session snapshot đã mở.
- Khách phát hiện ngoài tuyến cần quy trình thêm master/assignment rõ ràng, không tạo bản rác chỉ cho một phiên.

## 7. API dự kiến

```text
GET    /api/customers
POST   /api/customers
GET    /api/customers/:id
PATCH  /api/customers/:id
POST   /api/customers/:id/status
POST   /api/customers/:id/addresses
PATCH  /api/customers/:id/credit-profile
POST   /api/customers/merge-preview
POST   /api/customers/merge
GET    /api/customers/:id/timeline
```

## 8. UI

### Danh sách

- tìm theo mã/tên/SĐT/mã số thuế;
- filter khu vực, kênh, nhân viên, trạng thái, nợ/rủi ro;
- cảnh báo duplicate và thiếu thông tin.

### Chi tiết

```text
Tổng quan
Địa chỉ/liên hệ
Tuyến và người phụ trách
Đơn hàng/giao hàng
Công nợ/thanh toán
MCP/lịch sử ghé
Kế hoạch/follow-up
Lịch sử thay đổi
```

## 9. Permission

- Sales chỉ sửa trường được phép trong khách mình phụ trách.
- Đổi hạn mức/điều khoản/bảng giá cần quyền tài chính hoặc phê duyệt.
- Merge/suspend/inactive là quyền quản lý.
- Dữ liệu liên hệ và công nợ phải giới hạn theo scope.

## 10. Test matrix

```text
[ ] tạo khách với mã unique
[ ] duplicate phone/tax code được cảnh báo đúng
[ ] sửa master không đổi snapshot đơn cũ
[ ] suspended chặn xác nhận đơn mới nhưng vẫn thu nợ
[ ] merge giữ toàn bộ lịch sử tham chiếu
[ ] khách MCP session cũ không đổi khi master đổi
[ ] permission theo khu vực/assignment không rò dữ liệu
[ ] concurrent create không tạo duplicate code/source id
```

## 11. Checklist

```text
[ ] C-01 Audit customer tables/API/UI
[ ] C-02 Chốt customer master và snapshot boundary
[ ] C-03 Chốt duplicate/merge rules
[ ] C-04 Chốt status transitions
[ ] C-05 Chốt credit/price/assignment fields
[ ] C-06 Migration/backfill
[ ] C-07 Backend APIs
[ ] C-08 UI list/detail
[ ] C-09 Permission + audit tests
[ ] C-10 Production smoke/freeze v1
```

## 12. Open questions

```text
[ ] Một khách có thể thuộc nhiều tuyến/nhân viên cùng lúc không?
[ ] Hạn mức công nợ theo toàn khách hay theo chi nhánh?
[ ] Có khách chuỗi với nhiều điểm bán con không?
[ ] Mã khách hiện do hệ thống hay người dùng tự nhập?
```
