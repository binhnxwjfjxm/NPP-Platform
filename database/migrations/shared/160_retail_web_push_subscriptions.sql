-- Retail Web Push subscriptions owned by authenticated Owner accounts.
-- Provider-neutral: browser Push API + VAPID only. No third-party push provider state.

CREATE TABLE IF NOT EXISTS shared.retail_web_push_subscriptions (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  endpoint_hash char(64) NOT NULL CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  endpoint text NOT NULL CHECK (char_length(endpoint) BETWEEN 16 AND 4096 AND endpoint LIKE 'https://%'),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 40 AND 512),
  auth_secret text NOT NULL CHECK (char_length(auth_secret) BETWEEN 8 AND 256),
  expiration_time timestamptz NULL,
  user_agent text NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 1000),
  last_success_at timestamptz NULL,
  disabled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, endpoint_hash),
  CONSTRAINT retail_web_push_subscriptions_user_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS retail_web_push_subscriptions_user_idx
  ON shared.retail_web_push_subscriptions (installation_id, user_id, disabled_at, updated_at DESC);

COMMENT ON TABLE shared.retail_web_push_subscriptions IS
  'Thiết bị Web Push của Owner cho ứng dụng Bán tại quầy; endpoint/khóa do Push API trình duyệt cấp.';
