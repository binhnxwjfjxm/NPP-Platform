-- Cho phép mẫu in dùng chung lưu cỡ chữ theo phần trăm.
-- 100 là kích thước mặc định hiện tại; biên 80-140 giữ phiếu dễ đọc và tránh phá bố cục.

ALTER TABLE shared.document_print_template_settings
  ADD COLUMN IF NOT EXISTS font_size_percent smallint NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'document_print_template_settings_font_size_check'
       AND conrelid = 'shared.document_print_template_settings'::regclass
  ) THEN
    ALTER TABLE shared.document_print_template_settings
      ADD CONSTRAINT document_print_template_settings_font_size_check
      CHECK (font_size_percent BETWEEN 80 AND 140);
  END IF;
END $$;
