CREATE SCHEMA IF NOT EXISTS shared;

CREATE TABLE IF NOT EXISTS shared.core_audit_records (
  audit_id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  employee_id text NULL CHECK (employee_id IS NULL OR char_length(employee_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 160),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 160),
  resource_id text NULL CHECK (resource_id IS NULL OR char_length(resource_id) BETWEEN 1 AND 256),
  before_data jsonb NULL,
  after_data jsonb NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION shared.prevent_core_audit_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'core_audit_records_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS core_audit_records_append_only ON shared.core_audit_records;
CREATE TRIGGER core_audit_records_append_only
BEFORE UPDATE OR DELETE ON shared.core_audit_records
FOR EACH ROW EXECUTE FUNCTION shared.prevent_core_audit_record_mutation();

CREATE TABLE IF NOT EXISTS shared.core_outbox_events (
  event_id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  aggregate_type text NOT NULL CHECK (char_length(aggregate_type) BETWEEN 1 AND 160),
  aggregate_id text NOT NULL CHECK (char_length(aggregate_id) BETWEEN 1 AND 256),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 200),
  event_version integer NOT NULL CHECK (event_version > 0),
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  last_error text NULL,
  CONSTRAINT core_outbox_events_published_state CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published' AND published_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS core_audit_records_installation_occurred_idx
  ON shared.core_audit_records (installation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS core_audit_records_resource_occurred_idx
  ON shared.core_audit_records (installation_id, resource_type, resource_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS core_audit_records_request_idx
  ON shared.core_audit_records (installation_id, request_id);

CREATE INDEX IF NOT EXISTS core_outbox_events_pending_available_idx
  ON shared.core_outbox_events (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS core_outbox_events_aggregate_idx
  ON shared.core_outbox_events (installation_id, aggregate_type, aggregate_id, created_at);
