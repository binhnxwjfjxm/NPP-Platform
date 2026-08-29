-- Retail Print Windows relay. Additive only; production execution remains behind the standard backup/rehearsal gate.

CREATE TABLE IF NOT EXISTS shared.retail_print_agents (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  device_id uuid NOT NULL,
  device_name text NOT NULL CHECK (char_length(btrim(device_name)) BETWEEN 1 AND 120),
  protocol_version text NOT NULL CHECK (protocol_version = '1'),
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  pairing_code text NULL CHECK (pairing_code IS NULL OR pairing_code ~ '^[A-Z0-9]{8}$'),
  pairing_proof_hash text NULL CHECK (pairing_proof_hash IS NULL OR pairing_proof_hash ~ '^[0-9a-f]{64}$'),
  pairing_expires_at timestamptz NULL,
  paired_at timestamptz NULL,
  paired_by text NULL CHECK (paired_by IS NULL OR char_length(paired_by) BETWEEN 1 AND 160),
  last_seen_at timestamptz NULL,
  printer_name text NULL CHECK (printer_name IS NULL OR char_length(btrim(printer_name)) BETWEEN 1 AND 120),
  paper_width_mm integer NULL CHECK (paper_width_mm IS NULL OR paper_width_mm IN (58, 80)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retail_print_agents_installation_device_unique UNIQUE (installation_id, device_id),
  CONSTRAINT retail_print_agents_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT retail_print_agents_pairing_state_check CHECK (
    (pairing_code IS NULL AND pairing_expires_at IS NULL)
    OR (pairing_code IS NOT NULL AND pairing_expires_at IS NOT NULL)
    OR paired_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS retail_print_agents_pairing_code_unique
  ON shared.retail_print_agents (installation_id, pairing_code)
  WHERE pairing_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS retail_print_agents_credential_hash_unique
  ON shared.retail_print_agents (installation_id, credential_hash);

CREATE INDEX IF NOT EXISTS retail_print_agents_status_idx
  ON shared.retail_print_agents (installation_id, is_active, paired_at, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS shared.retail_print_jobs (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  agent_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{1,128}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'completed', 'failed')),
  queued_by text NOT NULL CHECK (char_length(queued_by) BETWEEN 1 AND 160),
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 1000),
  claimed_at timestamptz NULL,
  completed_at timestamptz NULL,
  error_code text NULL CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 80),
  error_message text NULL CHECK (error_message IS NULL OR char_length(error_message) BETWEEN 1 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retail_print_jobs_agent_fk
    FOREIGN KEY (installation_id, agent_id)
    REFERENCES shared.retail_print_agents (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT retail_print_jobs_idempotency_unique UNIQUE (installation_id, agent_id, queued_by, idempotency_key),
  CONSTRAINT retail_print_jobs_terminal_state_check CHECK (
    (status IN ('queued', 'claimed') AND completed_at IS NULL)
    OR (status IN ('completed', 'failed') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS retail_print_jobs_queue_idx
  ON shared.retail_print_jobs (installation_id, agent_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS retail_print_jobs_actor_idx
  ON shared.retail_print_jobs (installation_id, queued_by, created_at DESC);
