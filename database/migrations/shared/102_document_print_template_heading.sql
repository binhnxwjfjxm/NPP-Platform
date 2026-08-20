-- Issue #675: installation-scoped headings for business print templates.
-- Existing field visibility and page-size settings remain unchanged.

ALTER TABLE shared.document_print_template_settings
  ADD COLUMN IF NOT EXISTS heading text NULL,
  ADD COLUMN IF NOT EXISTS title text NULL,
  ADD COLUMN IF NOT EXISTS subtitle text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_print_template_settings_heading_length_check'
      AND conrelid = 'shared.document_print_template_settings'::regclass
  ) THEN
    ALTER TABLE shared.document_print_template_settings
      ADD CONSTRAINT document_print_template_settings_heading_length_check
      CHECK (heading IS NULL OR char_length(btrim(heading)) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_print_template_settings_title_length_check'
      AND conrelid = 'shared.document_print_template_settings'::regclass
  ) THEN
    ALTER TABLE shared.document_print_template_settings
      ADD CONSTRAINT document_print_template_settings_title_length_check
      CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_print_template_settings_subtitle_length_check'
      AND conrelid = 'shared.document_print_template_settings'::regclass
  ) THEN
    ALTER TABLE shared.document_print_template_settings
      ADD CONSTRAINT document_print_template_settings_subtitle_length_check
      CHECK (subtitle IS NULL OR char_length(btrim(subtitle)) BETWEEN 1 AND 240);
  END IF;
END $$;
