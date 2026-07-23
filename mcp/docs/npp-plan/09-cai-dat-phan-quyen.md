# NPP-09 — Plan Cài đặt và phân quyền

> Trạng thái: **FOUNDATION / PLANNED**  
> Vai trò: nền bắt buộc trước các mutation quan trọng  
> Mô hình: **một NPP mỗi deployment; không shared tenant**  
> Phụ thuộc: identity provider/auth hiện có, cấu trúc nhân viên/chi nhánh/kho và [`FOUNDATION_SINGLE_NPP_PORTABILITY.md`](./FOUNDATION_SINGLE_NPP_PORTABILITY.md)

## 1. Mục tiêu

Quản lý thông tin NPP, installation config, người dùng, nhân viên, vai trò, quyền, phạm vi và chính sách theo nguyên tắc deny-by-default.

Phải trả lời được:

```text
Người này đăng nhập bằng identity nào?
Có liên kết với nhân viên nào?
Ai được làm gì?
Trên chi nhánh/kho/khu vực/tuyến/khách nào?
Giới hạn giá trị bao nhiêu?
Có cần phê duyệt không?
Cấu hình/quyền có hiệu lực từ khi nào?
Installation hiện trỏ tới backend/database/storage nào?
Ai đã đổi quyền hoặc cấu hình?
```

Không có tenant selector, tenant membership hoặc quản trị nhiều NPP trong cùng runtime.

## 2. Tách identity, employee, role, permission và installation

```text
identity/user = tài khoản đăng nhập từ auth provider
employee      = hồ sơ nhân sự nghiệp vụ của NPP
role          = nhóm quyền thuận tiện
permission    = hành động cụ thể
scope         = phạm vi dữ liệu
policy        = điều kiện/threshold/approval
installation  = deployment hiện tại: frontend/backend/DB/storage/config
```

Không hardcode `if role === admin` rải khắp UI/backend.

Một identity trong installation hiện tại chỉ truy cập dữ liệu của NPP hiện tại. Nếu cùng một người dùng làm việc cho NPP khác, đó là tài khoản/identity được bootstrap trong installation khác; không dùng tenant switch.

## 3. InstallationContext và request context

Backend tạo context sau khi xác thực:

```text
installationId
distributorCode
actorId
employeeId nếu có
branch/warehouse/territory scope
roles/permissions/policies
requestId
```

Quy tắc:

1. `installationId` và `distributorCode` lấy từ server config.
2. Không tin installation/NPP code do frontend gửi để thay đổi phạm vi dữ liệu.
3. Actor phải đến từ auth/session hợp lệ.
4. Service role vẫn phải có actor business context và permission.
5. Background job có system actor và installation context rõ ràng.
6. Support/break-glass access phải có lý do, thời hạn và audit.
7. Cache/query sau đăng xuất hoặc đổi user không được tái sử dụng sai actor/scope.

## 4. Data model tối thiểu

Tên bảng cuối cùng chỉ khóa sau audit, nhưng cần các miền:

```text
installation_settings hoặc deployment metadata không chứa secret
organization_profile / distributor_profile
branches
warehouses
territories
employees
user_employee_links
roles
permissions
role_permissions
user_role_assignments hoặc employee_role_assignments
scope_assignments
policy_assignments
approval_requests
business_settings
feature_settings
audit_events
number_sequences
```

Không cần:

```text
tenants/organizations dùng để chứa nhiều NPP
tenant_memberships
tenant_installation_assignments
platform tenants registry
cross-tenant impersonation
```

Thông tin secret/kết nối hạ tầng không lưu lộ trong business tables; quản lý qua environment/secret store của từng deployment.

## 5. Phạm vi dữ liệu trong một NPP

Scope tối thiểu:

```text
organization-wide của installation hiện tại
branch
warehouse
territory
route
customer assignment
team/hierarchy
self
```

Bắt buộc:

- Backend/repository enforce scope cho cả read và mutation.
- UI chỉ hỗ trợ trải nghiệm, không phải security boundary.
- RLS/DB policy là defense-in-depth.
- System admin của installation không được bypass audit cho nghiệp vụ nhạy cảm.
- Không có endpoint “xem mọi NPP” vì mỗi deployment chỉ có một NPP.

## 6. Permission catalog tối thiểu

```text
profile.view/update
branch.view/manage
warehouse.view/manage
user.view/create/update/disable
employee.view/manage/assign
role.view/create/update/delete
permission.view/manage
audit.view
settings.view/manage
customer.view/create/update/status/merge
product.view/create/update/status/price
order.view/create/update_draft/confirm/amend/cancel
fulfillment.allocate/pick/pack/ship/deliver
inventory.view/adjust/stocktake/transfer
receivable.view/post/collect/allocate/credit/refund/writeoff
plan.view/create/assign/approve
report.view/export/snapshot
backup.view/run/restore_request
deployment.view_health
support.break_glass
```

Permission code mô tả hành động, không mô tả tên màn hình hoặc tên bảng.

## 7. Role mặc định dự kiến

```text
Owner/Admin NPP
Quản lý điều hành
Sales
Giám sát bán hàng
Kho
Giao hàng
Kế toán/Công nợ
Nhân viên MCP thị trường
Chỉ xem báo cáo
```

Role chỉ là tập permission. Backend luôn kiểm tra permission/scope/policy thực tế.

Không cho xóa/khóa owner/admin cuối cùng của installation.

## 8. Threshold và phê duyệt

Policy cần hỗ trợ:

```text
max_discount_percent
max_order_amount
credit_limit_override
max_inventory_adjustment
max_refund
max_writeoff
approval_required_above
export_sensitive_data
restore_or_destructive_operation
```

Luồng:

```text
request -> pending approval -> approved/rejected -> apply once
```

Approval phải tham chiếu actor, entity, payload/version cụ thể. Payload thay đổi sau duyệt thì approval cũ mất hiệu lực.

## 9. Phân lớp cấu hình

### 9.1 Deployment/environment config

```text
APP_ENV
APP_NAME
NPP_CODE
INSTALLATION_ID
APP_DOMAIN
PUBLIC_API_BASE_URL
DATABASE_URL hoặc SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY (backend only)
STORAGE_CONFIG
AUTH_CONFIG
CORS_ALLOWED_ORIGINS
LOG_LEVEL
```

Quy tắc:

- Secret không commit.
- Frontend không có service-role key.
- Thay backend/DB mới bằng config, không sửa business code.
- Clone source phải có `.env.example` đầy đủ nhưng không chứa secret thật.
- Không lưu URL/project ID/IP production rải trong source.

### 9.2 Business settings trong DB

```text
organization profile
branding
branch/warehouse
number sequences
timezone/currency
money/quantity rounding
order posting policy
inventory negative-stock policy
lot/expiry policy
receivable posting/aging policy
approval thresholds
notification/reminder
MCP templates ngoài frozen core boundary
report/export settings
feature settings
```

Cấu hình ảnh hưởng nghiệp vụ phải validate, version và có effective date khi cần. Không dùng một bảng key-value tùy ý cho mọi business rule.

## 10. Number sequence

Mã chứng từ cần atomic sequence:

```text
ORD
DEL
RET
EXC
PAY
CRN
STK
TRF
```

Quy tắc:

- unique trong database của NPP, có thể theo branch/year nếu policy yêu cầu;
- concurrent create không trùng;
- không tái sử dụng số đã hủy;
- prefix/format có version/effective date;
- không sinh bằng `max + 1` không khóa;
- clone installation mới có sequence/config riêng;
- import dữ liệu phải giữ hoặc map số chứng từ có reconciliation.

## 11. Backend enforcement

- Backend kiểm tra actor + permission + scope + policy trước mutation.
- Query read cũng áp scope tại repository/server/DB phù hợp.
- Domain/application không phụ thuộc Supabase auth hoặc schema permission.
- Auth provider được bọc qua adapter.
- Identity provider ID không dùng thay business employee ID.
- Public error trả business code trung tính.
- Service role chỉ nằm ở infrastructure adapter.
- Mutation quan trọng không cho browser/anon ghi trực tiếp bảng.

## 12. Audit log

Sự kiện tối thiểu:

```text
login/security change nếu auth provider hỗ trợ
user create/update/disable
employee-user link change
role/permission/scope change
settings/feature change
approval request/decision
sensitive export
backup/restore request
deployment config version change không chứa secret
order/inventory/receivable privileged action
break-glass/support access
```

Audit lưu:

```text
installationId
distributorCode
actorId/employeeId
action
entity type/id
before/after hoặc diff
reason
request/correlation id
time/ip/user agent khi phù hợp
```

Audit quan trọng không cho người dùng nghiệp vụ sửa/xóa.

## 13. API contract dự kiến

```text
GET   /api/installation-context
GET   /api/organization-profile
PATCH /api/organization-profile
GET   /api/settings
PATCH /api/settings/:group
GET   /api/users
POST  /api/users
PATCH /api/users/:id
GET   /api/employees
GET   /api/roles
POST  /api/roles
PATCH /api/roles/:id
GET   /api/permissions
POST  /api/role-assignments
POST  /api/scope-assignments
POST  /api/approval-requests
POST  /api/approval-requests/:id/approve
POST  /api/approval-requests/:id/reject
GET   /api/audit-logs
GET   /api/system/health
```

Endpoint deployment/backup nhạy cảm phải có surface riêng và permission mạnh; không trả secret hoặc connection string.

Success/error DTO tuân theo foundation, không trả auth/provider/database payload nguyên bản.

## 14. UI

```text
Thông tin NPP và thương hiệu
Chi nhánh/kho/khu vực
Tài khoản
Liên kết tài khoản - nhân viên
Vai trò
Ma trận quyền
Phạm vi dữ liệu
Hạn mức/phê duyệt
Cấu hình chứng từ
Cấu hình đơn/kho/công nợ
Module/tính năng
Thông báo
Audit log
Tình trạng hệ thống không lộ secret
Backup/export theo quyền
```

Không có màn tenant switch hoặc danh sách NPP toàn platform.

Màn quyền phải preview “người này thực tế làm được gì ở phạm vi nào”, không chỉ checkbox.

## 15. Bootstrap NPP mới

Khi clone source cho NPP mới:

```text
1. Tạo DB/backend/frontend/storage mới.
2. Điền environment và secrets mới.
3. Chạy migrations.
4. Chạy bootstrap idempotent.
5. Tạo organization profile.
6. Tạo owner/admin đầu tiên.
7. Tạo chi nhánh và kho mặc định.
8. Tạo role mặc định.
9. Cấu hình number sequence và chính sách nền.
10. Chạy auth/permission/MCP smoke.
```

Không tạo NPP mới bằng cách copy DB cũ rồi xóa dữ liệu thủ công.

Bootstrap phải chống tự khóa:

- không cho disable admin cuối cùng;
- có break-glass procedure được audit;
- migration permission phải giữ đường quản trị tối thiểu đã test;
- seed chạy lại không tạo duplicate role/config/admin.

## 16. Portability và đổi DB/backend

Yêu cầu:

```text
source clone
+ environment mới
+ migrations
+ bootstrap
+ deploy backend
+ deploy frontend
+ smoke tests
```

Không yêu cầu tenant export/import vì installation mới bắt đầu bằng DB riêng. Khi chuyển dữ liệu thật từ hệ thống cũ hoặc thay DB cho cùng NPP, dùng migration/import có manifest, checksum và reconciliation riêng.

Phải kiểm tra:

- schema/function/policy/grant đầy đủ trong repo;
- không còn project ID/URL/secret cũ;
- tổng đơn/tổng tiền/tồn kho/công nợ đúng sau import nếu có;
- backend/frontend không phải sửa business logic;
- rollback hoặc forward-fix rõ ràng.

## 17. Test matrix

```text
[ ] backend deny khi UI cố bypass
[ ] user đúng role nhưng sai scope bị chặn
[ ] threshold vượt mức tạo approval
[ ] payload đổi sau approval phải duyệt lại
[ ] admin cuối cùng không bị disable/xóa
[ ] sequence concurrent không trùng
[ ] settings version áp đúng effective date
[ ] service-role request thiếu actor context bị chặn ở mutation mới
[ ] privilege escalation qua tự sửa role bị chặn
[ ] audit ghi đúng actor/requestId
[ ] DB trắng chạy migrations thành công
[ ] bootstrap chạy lặp không duplicate
[ ] backend mới chạy bằng environment mới
[ ] frontend mới đổi API/config mà không sửa business code
[ ] clone không còn tham chiếu installation gốc
[ ] repository/canonical API tests pass
[ ] full MCP smoke pass trên installation mới
```

## 18. Checklist

```text
[x] S-01 Audit auth/user/RLS/backend liên quan order hiện có
[ ] S-02 Chốt InstallationContext/actor/requestId
[ ] S-03 Lập permission catalog
[ ] S-04 Chốt role mặc định
[ ] S-05 Chốt scope/threshold/approval
[ ] S-06 Chốt settings schema/version
[ ] S-07 Chốt audit contract
[ ] S-08 Audit hardcoded config/secrets/URLs
[ ] S-09 Đối chiếu DB production với migrations/functions/policies/grants
[ ] S-10 Viết bootstrap/seed idempotent
[ ] S-11 Backend authorization/policy service qua ports
[ ] S-12 UI profile/user/role/scope/settings/audit
[ ] S-13 Security/integration/repository contract tests
[ ] S-14 Clean-DB migration rehearsal
[ ] S-15 Clone/deploy installation thứ hai
[ ] S-16 Backup/restore/forward-fix smoke
[ ] S-17 Freeze foundation v1
```

## 19. Quyết định đã khóa

```text
[D-01] Một deployment chỉ phục vụ một NPP.
[D-02] Không dùng tenant selector/membership/shared DB trong phase hiện tại.
[D-03] Request dùng InstallationContext + actor + permission/scope.
[D-04] Mỗi NPP mới được bootstrap trong backend/DB riêng.
[D-05] Thay DB/backend bằng config + migrations + adapters, không sửa domain/UI contract.
[D-06] Owner/admin NPP là security surface cao nhất trong installation hiện tại.
[D-07] Secret hạ tầng không nằm trong business DB hoặc frontend.
[D-08] Không bắt buộc tenant_id trên mọi bảng.
[D-09] Shared multi-tenant chỉ là phase tương lai nếu có yêu cầu kinh doanh thật.
```

## 20. Open questions còn phải audit

```text
[ ] Cấu trúc chi nhánh/kho/khu vực hiện tại ra sao?
[ ] Auth hiện tại map user sang employee thế nào?
[ ] Có cấp duyệt nhiều tầng không?
[ ] Có cần MFA/SSO phase đầu không?
[ ] Bộ biến môi trường hiện tại có hardcode hoặc thiếu gì?
[ ] Migration repo có tái tạo đủ schema/function/policy/grant production không?
[ ] Bootstrap NPP mới cần dữ liệu mặc định nào?
[ ] Cần công cụ import dữ liệu khách/SP/tồn đầu kỳ theo định dạng nào?
[ ] VPS mới sẽ dùng cùng script deploy hay installer khác?
[ ] Backup/restore RPO/RTO mong muốn là bao nhiêu?
```