CREATE SCHEMA IF NOT EXISTS mcp;
REVOKE ALL ON SCHEMA mcp FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mcp.idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id text NOT NULL,
  command_name text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint char(64) NOT NULL,
  state text NOT NULL DEFAULT 'in_progress',
  request_id text NOT NULL,
  actor_id text NOT NULL,
  response jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT mcp_idempotency_records_scope_key
    UNIQUE (installation_id, command_name, idempotency_key),
  CONSTRAINT mcp_idempotency_records_fingerprint_format
    CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mcp_idempotency_records_state
    CHECK (state IN ('in_progress', 'completed')),
  CONSTRAINT mcp_idempotency_records_state_shape
    CHECK (
      (state = 'in_progress' AND response IS NULL AND completed_at IS NULL)
      OR
      (state = 'completed' AND response IS NOT NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS mcp_idempotency_records_started_idx
  ON mcp.idempotency_records (installation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS mcp_idempotency_records_expiry_idx
  ON mcp.idempotency_records (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS mcp.audit_events (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  installation_id text NOT NULL,
  actor_id text NOT NULL,
  actor_type text NOT NULL,
  employee_id text,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  source text NOT NULL,
  action text NOT NULL,
  permission text NOT NULL,
  scope text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_audit_events_installation_occurred_idx
  ON mcp.audit_events (installation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS mcp_audit_events_aggregate_idx
  ON mcp.audit_events (installation_id, aggregate_type, aggregate_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION mcp.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'mcp_audit_events_append_only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS mcp_audit_events_append_only ON mcp.audit_events;
CREATE TRIGGER mcp_audit_events_append_only
BEFORE UPDATE OR DELETE ON mcp.audit_events
FOR EACH ROW EXECUTE FUNCTION mcp.reject_audit_event_mutation();

CREATE TABLE IF NOT EXISTS mcp.outbox_events (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  installation_id text NOT NULL,
  actor_id text NOT NULL,
  actor_type text NOT NULL,
  employee_id text,
  request_id text NOT NULL,
  idempotency_key text NOT NULL,
  source text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_outbox_events_status
    CHECK (status IN ('pending', 'published', 'dead_letter')),
  CONSTRAINT mcp_outbox_events_published_shape
    CHECK (
      (status = 'published' AND published_at IS NOT NULL)
      OR
      (status <> 'published' AND published_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS mcp_outbox_events_pending_available_idx
  ON mcp.outbox_events (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS mcp_outbox_events_installation_idx
  ON mcp.outbox_events (installation_id, created_at DESC);

REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mcp.reject_audit_event_mutation() FROM PUBLIC;
