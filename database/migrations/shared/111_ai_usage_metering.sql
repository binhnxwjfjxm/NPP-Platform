-- Issue #764 / Lô A: canonical AI usage metering foundation.
-- Usage is an append-only operational ledger. USD is provider usage converted
-- with the immutable rate card that was effective when the provider call occurred.

CREATE TABLE IF NOT EXISTS shared.ai_rate_cards (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 160 AND id ~ '^[A-Za-z0-9._-]+$'),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 64 AND provider ~ '^[a-z0-9._-]+$'),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 128 AND model ~ '^[A-Za-z0-9._-]+$'),
  service_tier text NOT NULL DEFAULT 'standard' CHECK (char_length(service_tier) BETWEEN 1 AND 64 AND service_tier ~ '^[a-z0-9._-]+$'),
  input_modality text NOT NULL DEFAULT 'text' CHECK (input_modality IN ('text')),
  version text NOT NULL CHECK (char_length(version) BETWEEN 1 AND 128 AND version ~ '^[A-Za-z0-9._-]+$'),
  input_usd_per_million numeric(18,9) NOT NULL CHECK (input_usd_per_million >= 0),
  cached_input_usd_per_million numeric(18,9) NOT NULL CHECK (cached_input_usd_per_million >= 0),
  output_usd_per_million numeric(18,9) NOT NULL CHECK (output_usd_per_million >= 0),
  long_context_threshold_tokens bigint NULL CHECK (long_context_threshold_tokens IS NULL OR long_context_threshold_tokens > 0),
  long_input_usd_per_million numeric(18,9) NULL CHECK (long_input_usd_per_million IS NULL OR long_input_usd_per_million >= 0),
  long_cached_input_usd_per_million numeric(18,9) NULL CHECK (long_cached_input_usd_per_million IS NULL OR long_cached_input_usd_per_million >= 0),
  long_output_usd_per_million numeric(18,9) NULL CHECK (long_output_usd_per_million IS NULL OR long_output_usd_per_million >= 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz NULL CHECK (effective_to IS NULL OR effective_to > effective_from),
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_rate_cards_long_rates_complete CHECK (
    (long_context_threshold_tokens IS NULL
      AND long_input_usd_per_million IS NULL
      AND long_cached_input_usd_per_million IS NULL
      AND long_output_usd_per_million IS NULL)
    OR
    (long_context_threshold_tokens IS NOT NULL
      AND long_input_usd_per_million IS NOT NULL
      AND long_cached_input_usd_per_million IS NOT NULL
      AND long_output_usd_per_million IS NOT NULL)
  ),
  CONSTRAINT ai_rate_cards_effective_unique
    UNIQUE (provider, model, service_tier, input_modality, effective_from)
);

CREATE INDEX IF NOT EXISTS ai_rate_cards_lookup_idx
  ON shared.ai_rate_cards (provider, model, service_tier, input_modality, effective_from DESC);

CREATE TABLE IF NOT EXISTS shared.ai_credit_accounts (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_id uuid NOT NULL,
  credit_limit_usd numeric(18,2) NOT NULL DEFAULT 1000.00 CHECK (credit_limit_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, customer_id),
  CONSTRAINT ai_credit_accounts_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS shared.ai_usage_events (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_id uuid NULL,
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 240),
  source text NOT NULL CHECK (source IN ('admin', 'website', 'ordering')),
  feature text NOT NULL CHECK (char_length(feature) BETWEEN 1 AND 96 AND feature ~ '^[a-z0-9][a-z0-9._-]*$'),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 64 AND provider ~ '^[a-z0-9._-]+$'),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 128 AND model ~ '^[A-Za-z0-9._-]+$'),
  service_tier text NOT NULL CHECK (char_length(service_tier) BETWEEN 1 AND 64 AND service_tier ~ '^[a-z0-9._-]+$'),
  input_modality text NOT NULL CHECK (input_modality IN ('text')),
  prompt_tokens bigint NOT NULL CHECK (prompt_tokens >= 0),
  cached_tokens bigint NOT NULL DEFAULT 0 CHECK (cached_tokens >= 0 AND cached_tokens <= prompt_tokens),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  thinking_tokens bigint NOT NULL DEFAULT 0 CHECK (thinking_tokens >= 0),
  tool_use_prompt_tokens bigint NOT NULL DEFAULT 0 CHECK (tool_use_prompt_tokens >= 0),
  total_tokens bigint NOT NULL CHECK (
    total_tokens >= 0
    AND total_tokens = prompt_tokens + output_tokens + thinking_tokens + tool_use_prompt_tokens
  ),
  usage_usd numeric(18,9) NOT NULL CHECK (usage_usd >= 0),
  rate_card_id text NOT NULL,
  rate_card_version text NOT NULL CHECK (char_length(rate_card_version) BETWEEN 1 AND 128),
  applied_input_usd_per_million numeric(18,9) NOT NULL CHECK (applied_input_usd_per_million >= 0),
  applied_cached_input_usd_per_million numeric(18,9) NOT NULL CHECK (applied_cached_input_usd_per_million >= 0),
  applied_output_usd_per_million numeric(18,9) NOT NULL CHECK (applied_output_usd_per_million >= 0),
  long_context_applied boolean NOT NULL DEFAULT false,
  provider_request_id text NULL CHECK (provider_request_id IS NULL OR char_length(provider_request_id) BETWEEN 1 AND 240),
  conversation_id text NULL CHECK (conversation_id IS NULL OR char_length(conversation_id) BETWEEN 1 AND 240),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 240),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._-]+$'
  ),
  provider_usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_usage_metadata) = 'object'),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_events_customer_attribution CHECK (
    (source = 'admin' AND customer_id IS NULL)
    OR (source IN ('website', 'ordering') AND customer_id IS NOT NULL)
  ),
  CONSTRAINT ai_usage_events_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT ai_usage_events_rate_card_fk
    FOREIGN KEY (rate_card_id)
    REFERENCES shared.ai_rate_cards (id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ai_usage_events_installation_time_idx
  ON shared.ai_usage_events (installation_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_customer_time_idx
  ON shared.ai_usage_events (installation_id, customer_id, occurred_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_usage_events_source_time_idx
  ON shared.ai_usage_events (installation_id, source, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_model_time_idx
  ON shared.ai_usage_events (installation_id, model, occurred_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_events_provider_request_unique_idx
  ON shared.ai_usage_events (installation_id, provider, provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_events_idempotency_unique_idx
  ON shared.ai_usage_events (installation_id, actor_id, idempotency_key);

CREATE OR REPLACE FUNCTION shared.prevent_ai_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI ledger rows are append-only';
END;
$$;

DROP TRIGGER IF EXISTS ai_rate_cards_append_only ON shared.ai_rate_cards;
CREATE TRIGGER ai_rate_cards_append_only
BEFORE UPDATE OR DELETE ON shared.ai_rate_cards
FOR EACH ROW EXECUTE FUNCTION shared.prevent_ai_append_only_mutation();

DROP TRIGGER IF EXISTS ai_usage_events_append_only ON shared.ai_usage_events;
CREATE TRIGGER ai_usage_events_append_only
BEFORE UPDATE OR DELETE ON shared.ai_usage_events
FOR EACH ROW EXECUTE FUNCTION shared.prevent_ai_append_only_mutation();

-- Standard global Agent Platform rate cards verified for the initial Lot A contract.
-- Rows are immutable: future provider/model pricing must be added as a new version.
INSERT INTO shared.ai_rate_cards (
  id, provider, model, service_tier, input_modality, version,
  input_usd_per_million, cached_input_usd_per_million, output_usd_per_million,
  long_context_threshold_tokens, long_input_usd_per_million,
  long_cached_input_usd_per_million, long_output_usd_per_million,
  effective_from, source_reference
) VALUES
  (
    'google.gemini-2.5-pro.standard.2026-08-24',
    'google', 'gemini-2.5-pro', 'standard', 'text', '2026-08-24',
    1.25, 0.125, 10.00,
    200000, 2.50, 0.25, 15.00,
    '2026-08-24T00:00:00Z',
    'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing'
  ),
  (
    'google.gemini-2.5-flash.standard.2026-08-24',
    'google', 'gemini-2.5-flash', 'standard', 'text', '2026-08-24',
    0.30, 0.03, 2.50,
    NULL, NULL, NULL, NULL,
    '2026-08-24T00:00:00Z',
    'https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing'
  )
ON CONFLICT DO NOTHING;
