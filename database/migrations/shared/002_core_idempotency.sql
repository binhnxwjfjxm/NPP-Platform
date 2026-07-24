CREATE SCHEMA IF NOT EXISTS shared;

CREATE TABLE IF NOT EXISTS shared.core_idempotency_records (
  id bigserial PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) > 0),
  actor_id text NOT NULL CHECK (char_length(actor_id) > 0),
  http_method text NOT NULL CHECK (http_method ~ '^[A-Z]+$'),
  route text NOT NULL CHECK (char_length(route) > 0),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed')),
  response_status integer NULL CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_content_type text NULL,
  response_body jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  CONSTRAINT core_idempotency_records_scope_key
    UNIQUE (installation_id, actor_id, http_method, route, idempotency_key),
  CONSTRAINT core_idempotency_records_state_shape CHECK (
    (
      status = 'processing'
      AND response_status IS NULL
      AND response_content_type IS NULL
      AND response_body IS NULL
      AND finished_at IS NULL
    )
    OR
    (
      status IN ('completed', 'failed')
      AND response_status IS NOT NULL
      AND response_content_type IS NOT NULL
      AND response_body IS NOT NULL
      AND finished_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS core_idempotency_records_status_updated_idx
  ON shared.core_idempotency_records (status, updated_at);

CREATE INDEX IF NOT EXISTS core_idempotency_records_updated_idx
  ON shared.core_idempotency_records (updated_at);
