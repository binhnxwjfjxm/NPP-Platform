ALTER TABLE shared.leave_requests
  ALTER COLUMN requested_by_employee_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS request_source text NOT NULL DEFAULT 'SELF_SERVICE',
  ADD COLUMN IF NOT EXISTS manual_approver_name text NULL;

ALTER TABLE shared.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_request_source_check,
  ADD CONSTRAINT leave_requests_request_source_check
    CHECK (request_source IN ('SELF_SERVICE', 'MANUAL_PAPER')),
  DROP CONSTRAINT IF EXISTS leave_requests_manual_approver_name_check,
  ADD CONSTRAINT leave_requests_manual_approver_name_check
    CHECK (manual_approver_name IS NULL OR char_length(btrim(manual_approver_name)) BETWEEN 1 AND 150);

COMMENT ON COLUMN shared.leave_requests.request_source IS
  'Nguồn lập đơn nghỉ: SELF_SERVICE do nhân sự tự gửi; MANUAL_PAPER do quản lý/HR ghi nhận từ phiếu giấy.';

COMMENT ON COLUMN shared.leave_requests.manual_approver_name IS
  'Tên người đã duyệt trên phiếu giấy khi ghi nhận thủ công; không thay thế actor audit của hệ thống.';
