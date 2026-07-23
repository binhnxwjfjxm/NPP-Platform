# NPP-07 — Plan module Kế hoạch

> Trạng thái: **PLANNED**  
> Phụ thuộc: Nhân viên, khách hàng, MCP, order/report read models  
> Tích hợp: Follow-up, mục tiêu, lịch, báo cáo, AI sau này

## 1. Mục tiêu

Biến dữ liệu vận hành thành công việc có người chịu trách nhiệm, thời hạn và kết quả.

Phải hỗ trợ:

```text
Kế hoạch ngày/tuần/tháng
Mục tiêu
Công việc/action
Follow-up từ MCP/đơn/công nợ/kho
Phân công
Ưu tiên
Nhắc việc
Kết quả và bằng chứng
Đánh giá tiến độ
```

## 2. Tách plan, item và action log

```text
plan          = mục tiêu/phạm vi/kỳ kế hoạch
plan_item     = việc hoặc chỉ tiêu cụ thể
action_log    = diễn biến thực hiện
plan_snapshot = ảnh chốt để báo cáo/đối chiếu
```

Không dùng một trường note dài để thay cho lịch sử thực hiện.

## 3. Data model tối thiểu

```text
mcp_plans hoặc plans
plan_items
plan_assignments
plan_dependencies
plan_action_logs
plan_snapshots
plan_templates
reminders
```

Trạng thái item:

```text
backlog
planned
in_progress
blocked
done
cancelled
```

Kết quả và trạng thái phải tách biệt khi cần. Ví dụ done nhưng kết quả `not_achieved` vẫn hợp lệ nếu đã thực hiện nhưng không đạt mục tiêu.

## 4. Nguồn tạo việc

```text
manual
mcp_followup
customer_risk
order_exception
inventory_alert
receivable_overdue
report_insight
recurring_template
```

Mỗi việc tự động phải giữ `source_type/source_id` và chống duplicate theo rule rõ ràng.

## 5. Kế hoạch và mục tiêu

Plan phải có:

```text
title
period_start/period_end
scope
owner
status
objective
metric targets
approval
version
```

Khi chốt kế hoạch, thay đổi chỉ tiêu phải tạo version/amendment; không ghi đè mất bản đã giao.

## 6. Dependency và blocked

Một plan item có thể phụ thuộc item/chứng từ khác. `blocked` phải có:

```text
blocked_reason
blocked_by_type/id
blocked_at
next_review_at
```

Không để việc quá hạn nhưng không biết vì sao.

## 7. Follow-up MCP

MCP follow-up v1 tiếp tục là nguồn hoạt động thị trường. App Plan có thể đồng bộ/tham chiếu nhưng không âm thầm đổi contract MCP.

Quy tắc:

- giữ source MCP;
- gọi lặp không tạo hai action;
- hoàn tất action cập nhật liên kết theo contract riêng, không sửa bảng MCP tùy tiện;
- session đã khóa vẫn giữ lịch sử follow-up gốc.

## 8. API dự kiến

```text
GET    /api/plans
POST   /api/plans
GET    /api/plans/:id
PATCH  /api/plans/:id
POST   /api/plans/:id/submit
POST   /api/plans/:id/approve
POST   /api/plans/:id/items
PATCH  /api/plan-items/:id
POST   /api/plan-items/:id/status
POST   /api/plan-items/:id/logs
GET    /api/actions
POST   /api/actions/from-source
```

## 9. UI

```text
Hôm nay
Tuần này
Danh sách kế hoạch
Kanban/list/calendar
Việc quá hạn/blocked
Theo nhân viên/khách/tuyến
Chi tiết việc và timeline
Mục tiêu và tiến độ
```

Màn hình “Hôm nay” phải gọn, ưu tiên việc cần làm; không biến thành dashboard thứ hai.

## 10. Permission

- Nhân viên xem/cập nhật việc được giao.
- Quản lý tạo/duyệt kế hoạch đội trong scope.
- Không tự đổi owner/target đã duyệt nếu thiếu quyền.
- Action log không xóa; sửa sai bằng correction event.

## 11. Test matrix

```text
[ ] source gọi lại không tạo duplicate action
[ ] plan chốt giữ snapshot/version
[ ] item blocked lưu lý do và dependency
[ ] đổi người phụ trách có audit
[ ] done không đồng nghĩa đạt target
[ ] recurring template không tạo trùng kỳ
[ ] permission theo team/scope đúng
[ ] MCP follow-up link đúng nhưng không phá frozen contract
```

## 12. Checklist

```text
[ ] PL-01 Audit actions/follow-up/UI hiện có
[ ] PL-02 Chốt plan/item/log/snapshot boundary
[ ] PL-03 Chốt source/idempotency
[ ] PL-04 Chốt status/result/dependency
[ ] PL-05 Chốt approval/versioning
[ ] PL-06 Migration/backfill
[ ] PL-07 Backend APIs
[ ] PL-08 UI today/list/calendar
[ ] PL-09 MCP integration + permission tests
[ ] PL-10 Production smoke/freeze v1
```

## 13. Open questions

```text
[ ] Kế hoạch có cần duyệt trước khi giao không?
[ ] Mục tiêu theo doanh số đặt, giao hay thu tiền?
[ ] Có đồng bộ Google Calendar hay chỉ lịch nội bộ?
[ ] Follow-up MCP sẽ mirror hay reference trực tiếp?
```
