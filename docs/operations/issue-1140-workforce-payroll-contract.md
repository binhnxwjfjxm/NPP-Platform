# Issue #1140 — Lô 0: Audit và contract Nhân sự vận hành + Tính lương

## 1. Mục tiêu

Tài liệu này khóa contract trước khi triển khai các lô tiếp theo của Issue #1140.

Lô 0 **không thay đổi schema, API runtime, UI runtime hoặc production data**. Mục tiêu là:

- ghi lại sự thật hiện có trên `main`;
- xác định nguồn sự thật sau khi mở rộng HR/Workforce;
- khóa quy tắc dữ liệu theo ngày hiệu lực;
- khóa boundary quyền/scope;
- khóa dependency giữa Bảng công và Tính lương;
- xác định migration boundary cho Lô 1 trở đi.

Nếu implementation sau này cần đi khác contract này thì phải cập nhật decision document trước, không sửa chắp vá trực tiếp trong code.

---

## 2. Baseline đã audit

- Repo: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact `main` khi audit: `835c561c637538898db7aca5bb88e693565af797`.
- PR #1139 đã merge vào exact main trên.
- Toàn bộ 6 workflow gắn với head của PR #1139 đã hoàn tất `success`.
- Không có PR mở tại thời điểm audit cuối.
- Migration registry hiện kết thúc ở `148_workforce_attendance_movement`.
- Không suy đoán trạng thái deploy/migration/backup production từ trạng thái source.

Trước khi bắt đầu Lô 1 phải re-audit current `main`, open PR và migration registry vì có thể có luồng khác làm song song.

---

## 3. Sự thật schema hiện tại

### 3.1 Nhân sự

`shared.employees` hiện chỉ có các trường nghiệp vụ chính:

- mã;
- họ tên;
- `job_title` dạng text;
- điện thoại;
- email;
- `branch_id`;
- `is_active`;
- audit timestamps/actors.

Hiện **không có**:

- ngày bắt đầu làm việc;
- ngày kết thúc/nghỉ việc;
- hình thức lao động;
- lịch sử employment;
- lịch sử điều chuyển chi nhánh;
- Phòng/Bộ phận canonical;
- Vị trí công việc canonical;
- Quản lý trực tiếp canonical.

API `PATCH /api/employees/:id` hiện có thể update trực tiếp `branch_id`, `job_title` và `is_active`.

### 3.2 Chính sách làm việc

`shared.work_policies` đã version theo thời gian và có:

- `effective_from/effective_to`;
- kiểu thời gian;
- ngày làm;
- ngưỡng trễ/về sớm;
- OT flags;
- phương thức chấm công;
- quy tắc tính công.

`shared.employee_work_policy_assignments` đã giữ lịch sử policy theo nhân sự.

Đây là mô hình đúng và tiếp tục giữ.

### 3.3 Lịch và chấm công

`shared.work_schedules` là lịch theo nhân sự + ngày.

`shared.attendance_events` là event gốc append-only về mặt nghiệp vụ. Các điều chỉnh sinh event lineage mới, không rewrite event gốc.

Giữ nguyên nguyên tắc này.

### 3.4 Điều chỉnh và khóa kỳ

Hiện có:

- `shared.attendance_adjustment_requests`;
- `shared.attendance_period_locks`.

`attendance_period_locks` hiện biểu diễn trạng thái khóa theo khoảng ngày + chi nhánh/toàn Công Ty, chưa phải business lifecycle đầy đủ kiểu:

`Đang tổng hợp → Cần xử lý → Đã đối soát → Đã chốt`.

### 3.5 Nghỉ phép

Hiện có:

- `shared.leave_types`;
- `shared.leave_requests`.

Đơn nghỉ đã có snapshot loại nghỉ, paid/unpaid, approval, nửa ngày, attachment và audit/version.

Hiện **chưa có leave balance ledger**: cấp phép, phát sinh theo tháng, sử dụng, điều chỉnh, chuyển năm, hết hạn, nghỉ bù.

### 3.6 Tăng ca

Hiện policy chỉ có:

- `overtime_enabled`;
- `overtime_requires_approval`.

Chưa có canonical lifecycle:

`Đăng ký → Duyệt → Thực tế → Xác nhận số giờ được tính`.

### 3.7 Payroll

Không có payroll schema/API/UI canonical trên `main`.

Các test hiện tại còn chủ động xác nhận Bảng công không tự sinh penalty/payroll data. Boundary này là đúng và phải giữ.

---

## 4. Lỗi mô hình lịch sử đã xác nhận bằng code thật

Repository Bảng công hiện tạo candidate bằng:

- toàn bộ `shared.employees`;
- `CROSS JOIN generate_series(dateFrom, dateTo)`.

Vì vậy, nếu một nhân sự tồn tại trong `shared.employees`, hệ thống có thể sinh row cho các ngày trước khi người đó thực sự vào làm.

Cùng query này lấy:

- `e.branch_id`;
- join `shared.branches` theo `e.branch_id`.

Do đó Bảng công lịch sử hiện đang dùng **chi nhánh hiện tại**, không phải chi nhánh tại ngày công.

Các filter/scope theo chi nhánh cũng đang lọc trực tiếp bằng `e.branch_id`.

Đây là root cause P0 của Issue #1140.

---

## 5. Contract nguồn sự thật sau Lô 1+

### 5.1 Employee identity

`shared.employees.id` tiếp tục là canonical `employeeId`.

Không tạo employee identity thứ hai.

`shared.users.employee_id` tiếp tục liên kết auth với canonical employee.

### 5.2 Employment history

Phải có canonical employment history riêng để trả lời được câu hỏi:

> Nhân sự này có thuộc lực lượng lao động vào ngày X hay không?

Contract tối thiểu của một employment period:

- `employee_id`;
- `employment_type` hoặc quan hệ lao động;
- `effective_from`;
- `effective_to` nullable;
- lý do/ngữ cảnh kết thúc khi có;
- audit metadata;
- nguồn/backfill quality nếu dữ liệu legacy chưa xác minh đầy đủ.

Không dùng `is_active` làm lịch sử lao động.

`is_active` chỉ được xem là current/compatibility state.

Một employee có thể có nhiều employment periods theo thời gian để không khóa đường rehire trong tương lai.

### 5.3 Assignment history

Phải có canonical assignment history để trả lời:

> Vào ngày X nhân sự thuộc Chi nhánh/Phòng/Vị trí nào và quản lý trực tiếp là ai?

Final contract phải hỗ trợ:

- `employee_id`;
- `branch_id`;
- `department_id` khi Lô 2 tạo cơ cấu;
- `position_id` khi Lô 2 tạo cơ cấu;
- `manager_employee_id` nullable;
- `effective_from`;
- `effective_to` nullable;
- reason;
- actor/audit metadata.

Lô 1 được phép triển khai trước phần lịch sử chi nhánh; Lô 2 mở rộng cùng assignment contract cho Phòng/Bộ phận, Vị trí và Quản lý.

### 5.4 Current fields trên shared.employees

`shared.employees.branch_id` và `job_title` hiện có nhiều consumer cũ.

Không drop/rename đột ngột trong Lô 1.

Sau khi có assignment history:

- `shared.employees.branch_id` chỉ là compatibility/current projection;
- `job_title` chỉ là compatibility text;
- chúng **không còn là nguồn sự thật cho truy vấn lịch sử Workforce**.

Mọi API/UI Workforce mới phải dùng effective-dated resolver.

---

## 6. Quy tắc effective-date bắt buộc

### 6.1 Calendar semantics

Ngày nghiệp vụ Workforce dùng calendar date theo installation timezone hiện hành.

API contract trả ngày dạng canonical:

`YYYY-MM-DD`.

UI chỉ format để hiển thị; không dùng ISO timestamp thô làm ngày hiệu lực.

### 6.2 Range semantics

Để đồng bộ với policy hiện có, khoảng hiệu lực dùng inclusive boundaries:

`effective_from <= business_date AND (effective_to IS NULL OR effective_to >= business_date)`.

Khi có record mới bắt đầu ngày D, record cũ kết thúc ở D - 1.

Không cho hai employment/assignment record của cùng employee chồng ngày hiệu lực ở cùng dimension.

### 6.3 Resolver canonical

Lô 1 phải tạo một repository/service contract dùng chung tương đương:

`resolveEmployeeAtDate(employeeId, businessDate)`.

Kết quả tối thiểu:

- employee identity;
- có employment hiệu lực hay không;
- employment type;
- assignment có hiệu lực;
- branch tại ngày đó;
- sau Lô 2: department/position/manager tại ngày đó.

Không để Timesheet, Leave, OT, Payroll tự viết mỗi nơi một cách resolve riêng.

### 6.4 Historical query

Bảng công ngày X:

1. chỉ tạo row khi employee có employment hiệu lực tại X;
2. resolve branch/assignment tại X;
3. resolve Work Policy tại X;
4. resolve Schedule tại X;
5. tổng hợp Attendance Event/Leave/Adjustment tại X.

Không lấy current employee fields rồi suy ngược lịch sử.

---

## 7. Backfill contract

Không được giả vờ biết ngày vào làm/nghỉ việc nếu dữ liệu legacy không chứng minh được.

Trước migration Lô 1 phải audit dữ liệu thật và xác định evidence có thể dùng:

- employee audit history;
- employee created timestamp;
- work-policy assignment;
- schedule;
- attendance event;
- leave request;
- các nguồn canonical khác có thể chứng minh nhân sự đã tồn tại tại một thời điểm.

Nếu không đủ evidence để xác nhận ngày thật:

- backfill phải ghi rõ nguồn/quality;
- cho phép HR xác nhận/sửa ngày;
- không ghi một ngày suy đoán rồi coi là lịch sử chính xác.

Không dùng chỉ `is_active=true/false` để tự suy ra ngày bắt đầu/kết thúc.

---

## 8. Quyền và scope

Giữ deny-by-default.

Request context hiện có:

- `scopeAuthority = COMPANY | ASSIGNED`;
- `branchIds`;
- `warehouseIds`;
- `territoryIds`;
- `employeeId`.

Repo hiện chưa có canonical TEAM/department scope.

### Contract Lô 1

- Self: theo `requestContext.employeeId`.
- Company: toàn installation.
- Branch: record Workforce ngày X được scope theo **branch tại ngày X**, không theo current `employees.branch_id`.
- Warehouse/Territory không tự suy thành HR scope.

### Contract Lô 2+

Sau khi có `manager_employee_id`/Phòng-Bộ phận canonical mới được thêm team/manager approval scope.

Không suy quyền từ:

- job title text;
- tên role;
- display name;
- email.

---

## 9. Period lock và lifecycle công

`attendance_period_locks` tiếp tục là hard lock hiện có cho mutation.

Nhưng trước Payroll phải bổ sung business period lifecycle riêng hoặc mở rộng model có kiểm soát để biểu diễn:

`Đang tổng hợp → Cần xử lý → Đã đối soát → Đã chốt`.

Payroll không được coi “có một row lock” là đủ để hiểu toàn bộ trạng thái kỳ.

Khi một kỳ đã chốt:

- không rewrite Attendance Event;
- không update ngầm số liệu lịch sử;
- mọi ngoại lệ đi qua adjustment/audit contract.

---

## 10. Leave contract

`leave_requests` tiếp tục là nguồn sự thật của đơn nghỉ.

Lô phép mở rộng bằng append-only/reconcilable leave ledger cho:

- cấp phép;
- accrual;
- sử dụng;
- điều chỉnh;
- carry-over;
- expiry;
- compensatory leave.

Không lưu duy nhất một số `remaining_leave` rồi update đè.

Balance phải rebuild/đối soát được từ ledger.

---

## 11. OT contract

Canonical OT phải có lifecycle riêng.

Tối thiểu:

`SUBMITTED → APPROVED/REJECTED → ACTUAL_RECORDED → CONFIRMED`.

Payroll chỉ lấy số giờ/phút OT ở trạng thái xác nhận đủ điều kiện.

Attendance Event vẫn là evidence thời gian, không tự đồng nghĩa “OT được trả lương”.

---

## 12. Payroll boundary đã khóa

Sidebar Nhân sự chỉ thêm **một mục lớn**:

`Tính lương`.

Bên trong dùng tab con:

- Bảng lương;
- Đối soát;
- Thiết lập lương;
- Khoản thu & khấu trừ;
- Phiếu lương;
- Lịch sử kỳ lương.

Payroll chỉ được bắt đầu sau gate Lô 5:

- employment/assignment lịch sử đúng;
- leave balance đủ;
- OT đủ lifecycle;
- kỳ công có trạng thái đối soát/chốt;
- historical Timesheet tái hiện ổn định.

Input payroll:

`Bảng công đã chốt + Nghỉ + OT xác nhận + Hồ sơ lương + Khoản phát sinh`.

Payroll **không mutation ngược Attendance/Timesheet**.

Khoản tiền phân nhóm tối thiểu:

- Thu nhập lương;
- Khấu trừ;
- Hoàn chi phí.

Khoản cố định phải effective-dated.

Khoản linh động phải gắn kỳ và audit.

Công tác phí/hoàn chi có thể thanh toán cùng kỳ nhưng không mặc định là lương.

Không hard-code danh mục thưởng/phụ cấp/khấu trừ.

---

## 13. Audit PR #1139 và điểm còn sót

PR #1139 đã sửa DATE/ISO comparison ở Workforce policy/assignment/schedule và UI.

Tuy nhiên `npp-core/api/src/services/employee.js` trong luồng tạo nhân sự + gán policy vẫn còn compare dạng:

`String(policy.effective_from)`
và
`String(policy.effective_to)`.

Lô 1 phải gom sửa điểm này bằng **shared effective-date helper/contract**, không tạo helper thứ hai có semantics khác.

Đây là regression cùng root cause, không phải một business rule mới.

---

## 14. Migration boundary

Lô 0 không tạo migration.

Tại thời điểm audit, migration registry kết thúc ở 148. **Không khóa cứng số 149** vì chat/PR khác có thể chiếm số trước khi Lô 1 bắt đầu.

Trước Lô 1:

1. re-audit current `main`;
2. re-audit migration registry;
3. audit production provider/data thật;
4. xác nhận backup/restore gate theo Master Plan;
5. rồi mới chọn migration ID và backfill strategy.

Lô 1 migration dự kiến phải additive, không drop legacy columns ngay.

---

## 15. Gate Lô 1

Lô 1 chỉ đạt khi có test chứng minh tối thiểu:

1. nhân sự bắt đầu ngày 10 không xuất hiện ở ngày 09;
2. nhân sự kết thúc ngày 20 không xuất hiện từ ngày 21;
3. nhân sự ở A đến 31/08, sang B từ 01/09:
   - Bảng công tháng 8 hiển thị A;
   - Bảng công tháng 9 hiển thị B;
4. filter/scope branch dùng branch-at-date;
5. Work Policy vẫn resolve theo ngày như hiện tại;
6. Attendance Event không bị rewrite;
7. employee create/gán policy không còn DATE/ISO comparison khác contract;
8. historical query không còn phụ thuộc trực tiếp `shared.employees.branch_id`;
9. migration/backfill không khai báo dữ liệu suy đoán là dữ liệu đã xác minh;
10. exact-head CI xanh.

---

## 16. UI truth và hướng tiếp theo

Sidebar Nhân sự hiện có:

- Chấm công;
- Bảng công;
- Nghỉ và đơn nghỉ;
- Xử lý vi phạm công;
- Điều chỉnh công;
- Danh mục nhân sự;
- Ca / lịch làm việc;
- Chính sách làm việc.

Chưa có Tính lương.

Lô 1 không thêm Tính lương.

UI Lô 1 tập trung:

- ngày vào/nghỉ;
- lịch sử điều chuyển;
- dữ liệu lịch sử đúng theo ngày;
- cảnh báo dữ liệu legacy cần xác nhận nếu backfill không đủ evidence.

Payroll navigation chỉ được thêm khi đến Lô 6.

---

## 17. Kết luận Lô 0

Lô 0 khóa quyết định:

- P0 thật sự nằm ở employment + assignment history;
- `shared.employees` vẫn giữ identity, nhưng current branch/job title không được dùng làm historical source;
- effective-date resolver phải dùng chung;
- scope branch cũng phải historical theo ngày;
- Attendance Event giữ append-only;
- leave cần ledger;
- OT cần lifecycle;
- kỳ công cần business lifecycle trước Payroll;
- Payroll chỉ là downstream consumer của dữ liệu đã chốt;
- Lô 1 bắt đầu bằng audit dữ liệu/backfill + migration additive, không bằng UI.
