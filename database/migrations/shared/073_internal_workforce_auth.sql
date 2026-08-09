-- Phase 9.9: canonical internal workforce authentication and authorization state.
-- Additive only. Production execution is gated by the normal backup/rehearsal process.

CREATE TABLE IF NOT EXISTS shared.user_credentials (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 32 AND 512),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 100),
  locked_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, user_id),
  CONSTRAINT user_credentials_user_installation_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shared.user_scopes (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('BRANCH', 'WAREHOUSE', 'TERRITORY')),
  scope_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, user_id, scope_type, scope_id),
  CONSTRAINT user_scopes_user_installation_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_scopes_user_idx
  ON shared.user_scopes (installation_id, user_id, scope_type);

CREATE TABLE IF NOT EXISTS shared.user_sessions (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 64),
  access_channel text NOT NULL DEFAULT 'WEB' CHECK (access_channel = 'WEB'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  revoked_by text NULL CHECK (revoked_by IS NULL OR char_length(revoked_by) BETWEEN 1 AND 128),
  CONSTRAINT user_sessions_user_installation_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  CONSTRAINT user_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT user_sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS user_sessions_active_user_idx
  ON shared.user_sessions (installation_id, user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS user_sessions_installation_expiry_idx
  ON shared.user_sessions (installation_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS shared.security_owner_bindings (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('PERMANENT', 'TEMPORARY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, user_id),
  CONSTRAINT security_owner_bindings_user_installation_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS security_owner_bindings_kind_idx
  ON shared.security_owner_bindings (installation_id, owner_kind, user_id);
