# NPP-06 — Plan module Nhân viên

> Trạng thái: **PLANNED**  
> Phụ thuộc: User/role/permission, organization scope  
> Tích hợp: Khách hàng, MCP, đơn hàng, kho, công nợ, kế hoạch, báo cáo

## 1. Mục tiêu

Quản lý nhân viên như chủ thể vận hành có phân công và trách nhiệm rõ ràng, không đồng nhất hoàn toàn với tài khoản đăng nhập.

Phải hỗ trợ:

```text
Hồ sơ nhân viên
Tài khoản đăng nhập liên kết
Vai trò/chức danh
Chi nhánh/kho/khu vực
Phân công khách/tuyến
Trạng thái làm việc
Lịch sử điều chuyển
Hiệu suất và công việc
```

## 2. Tách employee và user

```text
employee = người trong tổ chức, hồ sơ và phân công
user     = danh tính đăng nhập/xác thực
```

Một employee có thể chưa có user. User bị khóa không làm mất lịch sử nghiệp vụ của employee.

## 3. Data model tối thiểu

```text
employees
employee_user_links
employee_roles
employee_assignments
employee_territories
employee_warehouse_access
employee_status_history
employee_manager_history
employee_targets
```

Trạng thái:

```text
pending
active
suspended
left
```

Không hard-delete nhân viên đã có hoạt động.

## 4. Phân công có hiệu lực thời gian

Assignment phải versioned/effective-dated:

```text
employee_id
assignment_type
scope_id
valid_from
valid_to
is_primary
```

Loại phân công:

```text
branch
warehouse
territory
route
customer
collection
approval
```

Khi đổi nhân viên phụ trách, lịch sử đơn/visit/thu tiền cũ vẫn giữ actor cũ; dashboard kỳ mới dùng assignment phù hợp theo định nghĩa metric.

## 5. Nghỉ việc/chuyển giao

Flow tối thiểu:

```text
mark leaving
-> khóa quyền tạo mới theo thời điểm
-> liệt kê khách/tuyến/việc/đơn/tiền đang phụ trách
-> chuyển giao có người nhận
-> xác nhận bàn giao
-> disable user
-> giữ toàn bộ lịch sử
```

Không chỉ xóa user rồi để dữ liệu mồ côi.

## 6. Mục tiêu và hiệu suất

Target phải có:

```text
period
metric_code
scope
value
unit
approved_by
version
```

Metric hiệu suất đọc từ nguồn nghiệp vụ đã khóa, ví dụ:

- doanh số xác nhận;
- doanh số thực giao;
- thu tiền;
- khách ghé;
- tỷ lệ chuyển đổi;
- công việc hoàn thành.

Không trộn các định nghĩa này thành một chỉ số mơ hồ.

## 7. API dự kiến

```text
GET    /api/employees
POST   /api/employees
GET    /api/employees/:id
PATCH  /api/employees/:id
POST   /api/employees/:id/status
POST   /api/employees/:id/assignments
POST   /api/employees/:id/handover
GET    /api/employees/:id/performance
POST   /api/employee-targets
```

## 8. UI

```text
Danh sách nhân viên
Hồ sơ
Tài khoản và vai trò
Phân công
Khách/tuyến phụ trách
Kho/quyền truy cập
Mục tiêu
Hiệu suất
Bàn giao
Audit
```

## 9. Permission

- HR/admin quản lý hồ sơ cơ bản.
- Quản lý vùng phân công trong scope của mình.
- Không cho người dùng tự nâng role/approval limit.
- Dữ liệu lương/nhạy cảm ngoài phạm vi module ban đầu.
- Manager chỉ xem hiệu suất đội của mình theo hierarchy hợp lệ.

## 10. Test matrix

```text
[ ] employee không user vẫn tồn tại hợp lệ
[ ] disable user không làm mất actor lịch sử
[ ] assignment theo valid_from/valid_to trả đúng thời điểm
[ ] chuyển khách/tuyến không mutate lịch sử cũ
[ ] nghỉ việc bắt buộc xử lý việc đang mở
[ ] permission manager không xem ngoài hierarchy
[ ] concurrent assignment không tạo hai primary trùng hiệu lực
```

## 11. Checklist

```text
[ ] E-01 Audit user/employee/owner fields hiện có
[ ] E-02 Chốt employee-user boundary
[ ] E-03 Chốt assignment model
[ ] E-04 Chốt lifecycle/handover
[ ] E-05 Chốt target/metric definitions
[ ] E-06 Migration/backfill actor
[ ] E-07 Backend APIs
[ ] E-08 UI + permission
[ ] E-09 Historical assignment tests
[ ] E-10 Production smoke/freeze v1
```

## 12. Open questions

```text
[ ] Một nhân viên có thể thuộc nhiều chi nhánh không?
[ ] Có đội nhóm/cấp quản lý nhiều tầng không?
[ ] Xe bán hàng có gắn như kho và assignment của nhân viên không?
[ ] Có cần chấm công/lương thưởng trong phase đầu không?
```
