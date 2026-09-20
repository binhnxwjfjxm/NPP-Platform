-- Issue #1110 Lô 3: QR attendance points and short-lived token foundation.
-- Source migration only. Production execution remains a separate gated operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.attendance-point.manage',
  'Nhân sự',
  'Quản lý điểm chấm công',
  'Cho phép tạo điểm chấm công và phát mã QR ngắn hạn trong phạm vi chi nhánh được cấp.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.attendance_points (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  branch_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT attendance_points_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_points_code_installation_unique UNIQUE (installation_id, code),
  CONSTRAINT attendance_points_branch_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS attendance_points_installation_active_idx
  ON shared.attendance_points (installation_id, is_active, branch_id, code);

CREATE TABLE IF NOT EXISTS shared.attendance_qr_tokens (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  attendance_point_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT attendance_qr_tokens_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_qr_tokens_hash_unique UNIQUE (installation_id, token_hash),
  CONSTRAINT attendance_qr_tokens_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT attendance_qr_tokens_point_fk
    FOREIGN KEY (installation_id, attendance_point_id)
    REFERENCES shared.attendance_points (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS attendance_qr_tokens_expiry_idx
  ON shared.attendance_qr_tokens (installation_id, expires_at);

ALTER TABLE shared.attendance_events
  ADD COLUMN IF NOT EXISTS attendance_point_id uuid NULL;

ALTER TABLE shared.attendance_events
  ADD CONSTRAINT attendance_events_point_fk
  FOREIGN KEY (installation_id, attendance_point_id)
  REFERENCES shared.attendance_points (installation_id, id)
  ON UPDATE RESTRICT
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS attendance_events_point_time_idx
  ON shared.attendance_events (installation_id, attendance_point_id, occurred_at DESC)
  WHERE attendance_point_id IS NOT NULL;
