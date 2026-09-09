-- Cấu hình phần đầu phiếu in dùng chung: hiển thị Tên Công Ty và vị trí hai tiêu đề.
-- Nội dung Tên Công Ty tiếp tục dùng cột heading hiện có; migration này chỉ bổ sung trạng thái/vị trí.

ALTER TABLE shared.document_print_template_settings
  ADD COLUMN IF NOT EXISTS heading_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS heading_align text NOT NULL DEFAULT 'left'
    CHECK (heading_align IN ('left', 'center', 'right')),
  ADD COLUMN IF NOT EXISTS title_align text NOT NULL DEFAULT 'right'
    CHECK (title_align IN ('left', 'center', 'right'));
