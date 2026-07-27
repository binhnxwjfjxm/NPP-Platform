-- Phase 3.3F: installation-scoped, concurrency-safe document numbering.
-- Historical allocations are append-only. Counter state is separated by reset period
-- so backdated allocations cannot corrupt another period's sequence.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.document-number.read', 'Số chứng từ', 'Xem cấu hình số chứng từ', 'Cho phép đọc series, bộ đếm và lịch sử cấp số chứng từ.', true, now()),
  ('core.document-number.write', 'Số chứng từ', 'Quản lý và cấp số chứng từ', 'Cho phép tạo, cập nhật series và cấp số chứng từ theo hợp đồng idempotent.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.document_number_series (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  document_type text NOT NULL CHECK (
    char_length(document_type) BETWEEN 1 AND 64
    AND document_type = upper(btrim(document_type))
    AND document_type ~ '^[A-Z0-9_.-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  prefix text NOT NULL DEFAULT '' CHECK (
    char_length(prefix) <= 32
    AND prefix = upper(btrim(prefix))
    AND prefix ~ '^[A-Z0-9_/-]{0,32}$'
  ),
  number_template text NOT NULL DEFAULT '{PREFIX}{YYYY}{MM}-{SEQ}' CHECK (
    char_length(number_template) BETWEEN 5 AND 128
    AND position('{SEQ}' in number_template) > 0
  ),
  reset_policy text NOT NULL DEFAULT 'YEARLY' CHECK (reset_policy IN ('NONE', 'YEARLY', 'MONTHLY')),
  sequence_width smallint NOT NULL DEFAULT 6 CHECK (sequence_width BETWEEN 1 AND 18),
  start_counter bigint NOT NULL DEFAULT 1 CHECK (start_counter BETWEEN 1 AND 999999999999999998),
  timezone_name text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK (char_length(btrim(timezone_name)) BETWEEN 1 AND 64),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT document_number_series_reset_template_check CHECK (
    reset_policy = 'NONE'
    OR (
      reset_policy = 'YEARLY'
      AND (position('{YYYY}' in number_template) > 0 OR position('{YY}' in number_template) > 0)
    )
    OR (
      reset_policy = 'MONTHLY'
      AND position('{MM}' in number_template) > 0
      AND (position('{YYYY}' in number_template) > 0 OR position('{YY}' in number_template) > 0)
    )
  ),
  CONSTRAINT document_number_series_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT document_number_series_code_installation_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS document_number_series_installation_type_idx
  ON shared.document_number_series (installation_id, document_type, is_active, code);

CREATE TABLE IF NOT EXISTS shared.document_number_counters (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  series_id uuid NOT NULL,
  period_key text NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 16),
  next_counter bigint NOT NULL CHECK (next_counter BETWEEN 1 AND 999999999999999999),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, series_id, period_key),
  CONSTRAINT document_number_counters_series_installation_fk
    FOREIGN KEY (installation_id, series_id)
    REFERENCES shared.document_number_series (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS shared.document_number_allocations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  series_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  document_date date NOT NULL,
  period_key text NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 16),
  counter_value bigint NOT NULL CHECK (counter_value BETWEEN 1 AND 999999999999999999),
  document_number text NOT NULL CHECK (char_length(document_number) BETWEEN 1 AND 160),
  allocated_at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT document_number_allocations_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT document_number_allocations_series_installation_fk
    FOREIGN KEY (installation_id, series_id)
    REFERENCES shared.document_number_series (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT document_number_allocations_idempotency_unique
    UNIQUE (installation_id, series_id, idempotency_key),
  CONSTRAINT document_number_allocations_counter_unique
    UNIQUE (installation_id, series_id, period_key, counter_value),
  CONSTRAINT document_number_allocations_number_unique
    UNIQUE (installation_id, document_number)
);

CREATE INDEX IF NOT EXISTS document_number_allocations_series_date_idx
  ON shared.document_number_allocations (installation_id, series_id, document_date DESC, allocated_at DESC);
CREATE INDEX IF NOT EXISTS document_number_allocations_request_idx
  ON shared.document_number_allocations (installation_id, request_id);

CREATE OR REPLACE FUNCTION shared.prevent_document_number_allocation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'document_number_allocations_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS document_number_allocations_append_only ON shared.document_number_allocations;
CREATE TRIGGER document_number_allocations_append_only
BEFORE UPDATE OR DELETE ON shared.document_number_allocations
FOR EACH ROW EXECUTE FUNCTION shared.prevent_document_number_allocation_mutation();
