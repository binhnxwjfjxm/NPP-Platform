ALTER TABLE shared.work_policies
  DROP CONSTRAINT IF EXISTS work_policies_attendance_method_check,
  ADD CONSTRAINT work_policies_attendance_method_check
    CHECK (attendance_method IN ('QR', 'MANUAL', 'BOTH', 'FACE', 'QR_FACE', 'NONE'));

ALTER TABLE shared.attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_source_check,
  ADD CONSTRAINT attendance_events_source_check
    CHECK (source IN ('QR', 'FACE', 'MANUAL', 'ADJUSTMENT', 'SYSTEM'));

CREATE TABLE IF NOT EXISTS shared.attendance_face_devices (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 128),
  branch_id uuid NOT NULL,
  attendance_point_id uuid NOT NULL,
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT attendance_face_devices_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_face_devices_credential_unique UNIQUE (installation_id, credential_hash),
  CONSTRAINT attendance_face_devices_branch_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT attendance_face_devices_point_fk
    FOREIGN KEY (installation_id, attendance_point_id)
    REFERENCES shared.attendance_points (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS attendance_face_devices_branch_idx
  ON shared.attendance_face_devices (installation_id, branch_id, is_active, created_at);

CREATE TABLE IF NOT EXISTS shared.employee_face_templates (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  model_code text NOT NULL CHECK (model_code = 'FACENET_128_V1'),
  dimensions integer NOT NULL CHECK (dimensions = 128),
  encrypted_embedding bytea NOT NULL,
  encryption_iv bytea NOT NULL CHECK (octet_length(encryption_iv) = 12),
  encryption_tag bytea NOT NULL CHECK (octet_length(encryption_tag) = 16),
  key_id text NOT NULL CHECK (char_length(btrim(key_id)) BETWEEN 1 AND 64),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  revoked_at timestamptz NULL,
  revoked_by text NULL CHECK (revoked_by IS NULL OR char_length(revoked_by) BETWEEN 1 AND 128),
  CONSTRAINT employee_face_templates_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT employee_face_templates_version_unique UNIQUE (installation_id, employee_id, version),
  CONSTRAINT employee_face_templates_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT employee_face_templates_revocation_check CHECK (
    (is_active = true AND revoked_at IS NULL AND revoked_by IS NULL)
    OR
    (is_active = false AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_face_templates_one_active_idx
  ON shared.employee_face_templates (installation_id, employee_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS employee_face_templates_active_model_idx
  ON shared.employee_face_templates (installation_id, model_code, employee_id)
  WHERE is_active = true;

COMMENT ON TABLE shared.employee_face_templates IS
  'Encrypted face-recognition embeddings only. Raw face images are not stored by this contract.';

COMMENT ON COLUMN shared.employee_face_templates.encrypted_embedding IS
  'AES-256-GCM encrypted normalized FaceNet embedding; decryption key remains server-side.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime')
     AND to_regprocedure('shared.grant_company_runtime_access(name)') IS NOT NULL THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;

