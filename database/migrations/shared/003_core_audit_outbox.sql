CREATE TABLE IF NOT EXISTS shared.core_audit_records (
  audit_id uuid PRIMARY KEY,
  installation_id text NOT NULL,
  actor_id text NOT NULL,
  employee_id text,
  source_app text NOT NULL,
  request_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared.core_outbox_events (
  event_id uuid PRIMARY KEY,
  installation_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NOT NULL,
  actor_id text NOT NULL,
  source_app text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'published', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_core_audit_records_installation_actor_occurred_at
  ON shared.core_audit_records (installation_id, actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_outbox_pending_available_at
  ON shared.core_outbox_events (status, available_at);
