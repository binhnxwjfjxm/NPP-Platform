-- Cho phép luồng tự duyệt có kiểm soát đã được backend xác thực theo vai trò/quyền.
-- Constraint từ migration 061 cấm tuyệt đối created_by = approved_by nên làm Owner tự duyệt lỗi ở tầng DB.
-- Việc ai được tự duyệt vẫn do service inventory-adjustment kiểm soát; migration này chỉ gỡ luật DB cũ xung đột contract hiện hành.

ALTER TABLE inventory.inventory_adjustments
  DROP CONSTRAINT IF EXISTS inventory_adjustments_creator_approver_separation_ck;
