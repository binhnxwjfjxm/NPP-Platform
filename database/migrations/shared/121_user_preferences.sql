-- User-owned presentation defaults for repeated operational entry.
-- These values do not change permissions, warehouse scope, pricing, inventory or document lifecycle.

CREATE TABLE IF NOT EXISTS shared.user_preferences (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  preference_key text NOT NULL CHECK (
    char_length(preference_key) BETWEEN 1 AND 128
    AND preference_key ~ '^[A-Za-z0-9._-]+$'
  ),
  preference_value jsonb NOT NULL CHECK (jsonb_typeof(preference_value) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, user_id, preference_key),
  CONSTRAINT user_preferences_user_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS user_preferences_user_idx
  ON shared.user_preferences (installation_id, user_id, updated_at DESC);
