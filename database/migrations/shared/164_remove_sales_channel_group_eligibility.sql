-- Migration mới để loại cơ chế phụ nhóm–kênh thêm tại 163, giữ nguyên migration lịch sử.
-- Cấm xóa nếu đã có cấu hình: bắt buộc audit/đối soát thay vì mất dữ liệu âm thầm.
DO $$
BEGIN
  IF to_regclass('shared.sales_channel_customer_groups') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM shared.sales_channel_customer_groups) THEN
      RAISE EXCEPTION 'sales_channel_customer_groups is not empty; audit before removal';
    END IF;
    DROP TABLE shared.sales_channel_customer_groups;
  END IF;
END
$$;
