-- Phase 9.9 follow-up: configurable Web/PWA login challenge policy and one-time owner approval codes.
-- Additive only. Production execution remains gated by shared-DB backup/restore rehearsal.

ALTER TABLE shared.roles
  ADD COLUMN IF NOT EXISTS web_login_challenge_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shared.internal_login_challenges (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 100),
  consumed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  CONSTRAINT internal_login_challenges_user_installation_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  CONSTRAINT internal_login_challenges_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT internal_login_challenges_terminal_state_check CHECK (
    consumed_at IS NULL OR cancelled_at IS NULL
  )
);

CREATE INDEX IF NOT EXISTS internal_login_challenges_active_user_idx
  ON shared.internal_login_challenges (installation_id, user_id, source_app, created_at DESC)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS internal_login_challenges_expiry_idx
  ON shared.internal_login_challenges (installation_id, expires_at)
  WHERE consumed_at IS NULL AND cancelled_at IS NULL;
