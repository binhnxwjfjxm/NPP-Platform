-- Phase 8.7: canonical import/export job history + Admin control-tower permission metadata.
-- No role grant, no production execution and no legacy browser-download backfill is introduced here.

CREATE SCHEMA IF NOT EXISTS reporting;

CREATE TABLE IF NOT EXISTS reporting.import_export_jobs (
  job_id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  direction text NOT NULL CHECK (direction IN ('IMPORT', 'EXPORT')),
  definition_key text NOT NULL CHECK (char_length(definition_key) BETWEEN 1 AND 160),
  definition_version text NOT NULL CHECK (char_length(definition_version) BETWEEN 1 AND 80),
  format text NOT NULL CHECK (char_length(format) BETWEEN 1 AND 32),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  employee_id text NULL CHECK (employee_id IS NULL OR char_length(employee_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  normalized_filters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_filters) = 'object'),
  effective_scopes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(effective_scopes) = 'object'),
  business_timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK (char_length(business_timezone) BETWEEN 1 AND 80),
  source_as_of timestamptz NULL,
  row_count bigint NULL CHECK (row_count IS NULL OR row_count >= 0),
  result_object_key text NULL CHECK (result_object_key IS NULL OR char_length(result_object_key) BETWEEN 1 AND 1024),
  result_checksum_sha256 text NULL CHECK (result_checksum_sha256 IS NULL OR result_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  failure_code text NULL CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 160),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_export_jobs_terminal_state CHECK (
    (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
    OR (status IN ('queued', 'running') AND completed_at IS NULL)
  ),
  CONSTRAINT import_export_jobs_result_state CHECK (
    (status = 'completed') OR (result_object_key IS NULL AND result_checksum_sha256 IS NULL)
  ),
  CONSTRAINT import_export_jobs_failure_state CHECK (
    (status = 'failed') OR failure_code IS NULL
  )
);

CREATE INDEX IF NOT EXISTS import_export_jobs_installation_requested_idx
  ON reporting.import_export_jobs (installation_id, requested_at DESC, job_id DESC);
CREATE INDEX IF NOT EXISTS import_export_jobs_installation_status_requested_idx
  ON reporting.import_export_jobs (installation_id, status, requested_at DESC, job_id DESC);
CREATE INDEX IF NOT EXISTS import_export_jobs_installation_definition_requested_idx
  ON reporting.import_export_jobs (installation_id, definition_key, requested_at DESC, job_id DESC);
CREATE INDEX IF NOT EXISTS import_export_jobs_request_idx
  ON reporting.import_export_jobs (installation_id, request_id);

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  (
    'core.reporting.audit-history.read',
    'Lịch sử vận hành',
    'Xem audit và lịch sử import/export',
    'Cho phép đọc audit/activity append-only và metadata lịch sử import/export canonical trong đúng installation.',
    true,
    now()
  ),
  (
    'core.reporting.control-tower.read',
    'Điều hành quản lý',
    'Xem Admin Control Tower',
    'Cho phép đọc tập aggregate quản lý đã phê duyệt từ các contract báo cáo Phase 8 trong phạm vi được cấp; không cấp quyền xem toàn bộ chi tiết.',
    true,
    now()
  ),
  (
    'core.reporting.export',
    'Xuất báo cáo',
    'Yêu cầu xuất báo cáo chính thức',
    'Cho phép yêu cầu export canonical khi đồng thời có quyền đọc report-family tương ứng; quyền này không tự cấp quyền xem báo cáo.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
