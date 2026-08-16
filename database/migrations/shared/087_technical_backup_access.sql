-- Issue #562 Part 1: technical unlock for system backup access.
-- The technical recipient is intentionally fixed in database and application code.

CREATE TABLE IF NOT EXISTS shared.technical_backup_access_challenges (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) > 0),
  requested_by text NOT NULL CHECK (char_length(requested_by) > 0),
  source_app text NOT NULL CHECK (char_length(source_app) > 0),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'CHALLENGE_PENDING' CHECK (status IN (
    'CHALLENGE_PENDING','UNLOCKED','FAILED','EXPIRED','REVOKED'
  )),
  recipient_email text NOT NULL DEFAULT 'khuongbinh.info@gmail.com'
    CHECK (recipient_email = 'khuongbinh.info@gmail.com'),
  challenge_code_hash text NOT NULL CHECK (challenge_code_hash ~ '^[0-9a-f]{64}$'),
  challenge_expires_at timestamptz NOT NULL,
  challenge_failed_attempts smallint NOT NULL DEFAULT 0 CHECK (challenge_failed_attempts BETWEEN 0 AND 10),
  challenge_sent_at timestamptz NULL,
  challenge_verified_at timestamptz NULL,
  unlock_token_hash text NULL CHECK (unlock_token_hash IS NULL OR unlock_token_hash ~ '^[0-9a-f]{64}$'),
  unlock_expires_at timestamptz NULL,
  failure_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'UNLOCKED'
    OR (challenge_verified_at IS NOT NULL AND unlock_token_hash IS NOT NULL AND unlock_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS technical_backup_access_actor_created_idx
  ON shared.technical_backup_access_challenges (installation_id, requested_by, created_at DESC);

CREATE INDEX IF NOT EXISTS technical_backup_access_active_idx
  ON shared.technical_backup_access_challenges (installation_id, requested_by, unlock_expires_at DESC)
  WHERE status = 'UNLOCKED';
