-- Issue #606 · Lô A: complete the management proposal round-trip contract.
-- This migration is repository-owned only. Production execution remains separately gated.

ALTER TABLE shared.management_proposals
  ADD COLUMN IF NOT EXISTS content text;

UPDATE shared.management_proposals
SET content = title
WHERE content IS NULL OR btrim(content) = '';

ALTER TABLE shared.management_proposals
  ALTER COLUMN content SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'management_proposals_content_check'
      AND conrelid = 'shared.management_proposals'::regclass
  ) THEN
    ALTER TABLE shared.management_proposals
      ADD CONSTRAINT management_proposals_content_check
      CHECK (length(btrim(content)) BETWEEN 1 AND 4000);
  END IF;
END $$;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES (
  'core.management-proposal.submit',
  'Đề xuất quản trị',
  'Gửi đề xuất quản trị',
  'Cho phép nhân viên Công Ty gửi đề xuất lên Admin và đọc lại đúng đề xuất do mình tạo.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
