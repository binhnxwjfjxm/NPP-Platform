-- Lô 2: shared, installation-scoped print-template overrides.
-- The supported document types, available fields and defaults stay server-owned;
-- this table stores only an installation's approved deviation from those defaults.
-- Permissions are registered only; existing roles keep deny-by-default until an
-- authorized Company administrator grants the appropriate permission.

CREATE TABLE IF NOT EXISTS shared.document_print_template_settings (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  document_type text NOT NULL CHECK (document_type ~ '^[A-Z0-9_.-]{1,64}$'),
  template_code text NOT NULL CHECK (template_code ~ '^[a-z0-9._-]{1,64}$'),
  page_size text NOT NULL CHECK (page_size IN ('A4', 'A5')),
  visible_field_keys jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(visible_field_keys) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT document_print_template_settings_installation_unique
    UNIQUE (installation_id, document_type, template_code)
);

CREATE INDEX IF NOT EXISTS document_print_template_settings_lookup_idx
  ON shared.document_print_template_settings (installation_id, document_type, template_code);

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  (
    'core.print-template.read',
    'Mẫu in',
    'Xem cấu hình mẫu in',
    'Cho phép đọc các mẫu in và phần thông tin được phép hiển thị trên chứng từ.',
    true,
    now()
  ),
  (
    'core.print-template.manage',
    'Mẫu in',
    'Quản lý cấu hình mẫu in',
    'Cho phép thay đổi khổ giấy và các phần được in của mẫu chứng từ dùng chung.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
