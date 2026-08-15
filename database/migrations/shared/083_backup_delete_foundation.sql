-- Backup + delete authorization foundation.
-- Application backup artifacts remain private; production purge execution is intentionally out of scope.

CREATE SCHEMA IF NOT EXISTS shared;

CREATE TABLE IF NOT EXISTS shared.backup_jobs (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) > 0),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN (
    'QUEUED','SNAPSHOTTING','DUMPING_DATABASE','EXPORTING_DATASETS','BUILDING_ARCHIVE',
    'HASHING','UPLOADING_R2','VERIFYING_R2','VERIFIED','FAILED'
  )),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  requested_by text NOT NULL CHECK (char_length(requested_by) > 0),
  source_app text NOT NULL CHECK (char_length(source_app) > 0),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  include_xlsx boolean NOT NULL DEFAULT true,
  snapshot_at timestamptz NULL,
  schema_version text NULL,
  dump_object_key text NULL,
  dump_size bigint NULL CHECK (dump_size IS NULL OR dump_size >= 0),
  dump_sha256 text NULL CHECK (dump_sha256 IS NULL OR dump_sha256 ~ '^[0-9a-f]{64}$'),
  csv_object_key text NULL,
  csv_size bigint NULL CHECK (csv_size IS NULL OR csv_size >= 0),
  csv_sha256 text NULL CHECK (csv_sha256 IS NULL OR csv_sha256 ~ '^[0-9a-f]{64}$'),
  xlsx_object_key text NULL,
  xlsx_size bigint NULL CHECK (xlsx_size IS NULL OR xlsx_size >= 0),
  xlsx_sha256 text NULL CHECK (xlsx_sha256 IS NULL OR xlsx_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_object_key text NULL,
  manifest_sha256 text NULL CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'),
  dataset_count integer NOT NULL DEFAULT 0 CHECK (dataset_count >= 0),
  total_row_count bigint NOT NULL DEFAULT 0 CHECK (total_row_count >= 0),
  failure_code text NULL,
  failure_message_safe text NULL,
  verified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS backup_jobs_one_active_per_installation_idx
  ON shared.backup_jobs (installation_id)
  WHERE status IN (
    'QUEUED','SNAPSHOTTING','DUMPING_DATABASE','EXPORTING_DATASETS','BUILDING_ARCHIVE',
    'HASHING','UPLOADING_R2','VERIFYING_R2'
  );
CREATE INDEX IF NOT EXISTS backup_jobs_installation_requested_idx
  ON shared.backup_jobs (installation_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS shared.backup_job_datasets (
  backup_job_id uuid NOT NULL REFERENCES shared.backup_jobs(id) ON DELETE CASCADE,
  dataset_key text NOT NULL CHECK (char_length(dataset_key) BETWEEN 1 AND 256),
  row_count bigint NOT NULL CHECK (row_count >= 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  exported_at timestamptz NOT NULL,
  PRIMARY KEY (backup_job_id, dataset_key)
);

CREATE TABLE IF NOT EXISTS shared.data_deletion_intents (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) > 0),
  backup_job_id uuid NOT NULL REFERENCES shared.backup_jobs(id),
  status text NOT NULL DEFAULT 'CHALLENGE_PENDING' CHECK (status IN ('CHALLENGE_PENDING','AUTHORIZED','FAILED','CANCELLED')),
  requested_by text NOT NULL CHECK (char_length(requested_by) > 0),
  source_app text NOT NULL CHECK (char_length(source_app) > 0),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  reason text NULL CHECK (reason IS NULL OR char_length(reason) <= 1000),
  challenge_code_hash text NOT NULL CHECK (challenge_code_hash ~ '^[0-9a-f]{64}$'),
  challenge_expires_at timestamptz NOT NULL,
  challenge_failed_attempts smallint NOT NULL DEFAULT 0 CHECK (challenge_failed_attempts BETWEEN 0 AND 10),
  challenge_sent_at timestamptz NULL,
  challenge_verified_at timestamptz NULL,
  owner_recipient_count integer NOT NULL CHECK (owner_recipient_count > 0),
  authorized_at timestamptz NULL,
  failure_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_deletion_intents_installation_created_idx
  ON shared.data_deletion_intents (installation_id, created_at DESC);

INSERT INTO shared.permission_catalog (permission_key, module, label, description, is_system, created_at) VALUES
  ('core.backup.read', 'Dữ liệu & sao lưu', 'Xem bản sao lưu', 'Cho phép xem trạng thái và lịch sử bản sao lưu của installation hiện tại.', true, now()),
  ('core.backup.create', 'Dữ liệu & sao lưu', 'Tạo bản sao lưu', 'Cho phép yêu cầu sao lưu toàn bộ dữ liệu canonical của installation hiện tại.', true, now()),
  ('core.backup.download', 'Dữ liệu & sao lưu', 'Tải bản sao lưu', 'Cho phép cấp liên kết tải ngắn hạn cho artifact sao lưu đã xác minh.', true, now()),
  ('core.data-deletion.authorize', 'Dữ liệu & sao lưu', 'Xác minh yêu cầu xóa dữ liệu', 'Cho phép tạo và xác minh Delete Intent đã được bảo vệ bằng backup VERIFIED và mã Owner.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
