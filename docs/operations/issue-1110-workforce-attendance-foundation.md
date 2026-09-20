# Issue #1110 — Lô 1: Nền Nhân sự & Chấm công

## Phạm vi

Lô này khóa **domain + contract nền**, chưa làm UI chấm công, QR runtime, bảng công tổng hợp hoặc điều chỉnh công.

## Sự thật đã audit trên `main`

- Nhân viên canonical đã tồn tại ở `shared.employees`.
- Người dùng nội bộ liên kết một-một tới nhân viên qua `shared.users.employee_id`; field này bất biến sau khi tạo user.
- Internal session join trực tiếp `shared.users -> shared.employees` và principal/request context đã mang `employeeId`.
- Authorization hiện có deny-by-default bằng permission registry.
- Scope canonical hiện có: `BRANCH`, `WAREHOUSE`, `TERRITORY`; request context tương ứng có `branchIds`, `warehouseIds`, `territoryIds`.
- Security Owner nhận permission registry đầy đủ và installation branch/warehouse scope; role bình thường chỉ nhận permission đã gán.
- Audit/outbox canonical là `shared.core_audit_records` + `shared.core_outbox_events`.
- Idempotency canonical là `shared.core_idempotency_records` và generator/normalizer dùng chung `@npp/contracts`.

Vì vậy **không tạo identity nhân sự thứ hai**, không tạo bảng user/employee mới và không tạo idempotency/audit/outbox riêng cho chấm công.

## Quyết định domain

### Work Policy

`shared.work_policies` là bảng versioned. Một policy thay đổi nghiệp vụ phải tạo version mới; assignment/schedule lịch sử tham chiếu version cụ thể để không làm đổi kết quả quá khứ.

Các fact nền:
- kiểu thời gian: cố định / theo ca / linh hoạt / không chấm công;
- giờ cố định nếu áp dụng;
- ngày làm việc;
- nghỉ giữa ca;
- ngưỡng trễ/về sớm;
- tăng ca;
- phương thức QR/nhập tay;
- múi giờ;
- làm tròn;
- hiệu lực.

### Gán chính sách

`shared.employee_work_policy_assignments` giữ khoảng hiệu lực của policy theo nhân viên. API ở lô sau phải khóa/serialize khi thay assignment để từ chối khoảng ngày chồng nhau; migration không thêm extension PostgreSQL chỉ để dùng exclusion constraint.

### Schedule

`shared.work_schedules` là lịch thực tế theo nhân viên + ngày:
- `WORK` hoặc `OFF`;
- thời điểm bắt đầu/kết thúc là `timestamptz`, nên ca qua ngày không cần quy ước giờ đặc biệt;
- `POLICY` hoặc `OVERRIDE`;
- override bắt buộc có lý do.

### Attendance Event

`shared.attendance_events` là event gốc append-only ở tầng nghiệp vụ:
- check-in/check-out;
- thời điểm;
- nguồn QR / nhập tay / điều chỉnh / hệ thống;
- trạng thái validation;
- employee/schedule/policy lineage;
- actor + request ID;
- source reference có unique index để hỗ trợ chống replay ở nguồn có external reference.

Không dùng event này làm bảng tổng hợp. Bảng công/read model làm ở lô sau.

## Quyền

Permission mới:
- `core.work-policy.read`
- `core.work-policy.manage`
- `core.work-schedule.read`
- `core.work-schedule.manage`
- `core.attendance.self.read`
- `core.attendance.self.record`
- `core.attendance.read`
- `core.attendance.adjust`

Tất cả vẫn deny-by-default.

## Scope

Lô này **không tự tạo TEAM scope** vì repo hiện chưa có canonical team/org-unit scope.

Contract ban đầu:
- self: bắt buộc `requestContext.employeeId` đúng employee mục tiêu;
- quản lý theo chi nhánh: dùng canonical `branchIds` + `shared.employees.branch_id`;
- owner: installation-wide như auth hiện hành;
- warehouse/territory không được tự suy thành phạm vi HR nếu nghiệp vụ chưa khóa.

Nếu sau này Công Ty có canonical phòng ban/team, bổ sung scope bằng migration riêng thay vì dùng tên/chức danh để suy quyền.

## Idempotency / audit / outbox

Mọi mutation HTTP ở các lô tiếp theo phải:
- yêu cầu/reuse canonical `Idempotency-Key` khi retryable;
- dùng `@npp/contracts`, không tự ghép key;
- dùng `withAuditOutboxTransaction`;
- audit actor/employee/request/source và before/after phù hợp;
- chỉ phát outbox khi có consumer/domain event thật sự cần, không tạo outbox giả để đủ số lượng.

## Boundary

Không có dependency từ foundation này sang `sales`, `inventory`, `purchasing`, `logistics` hoặc `mcp`.

Lô 2 mới triển khai API/UI quản lý policy, gán policy và lịch làm việc. Lô 3 mới triển khai QR/check-in/check-out runtime.
