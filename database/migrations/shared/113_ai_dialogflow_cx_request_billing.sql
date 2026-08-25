-- Issue #764: Dialogflow CX Website request-based billing.
-- Dialogflow CX DetectIntent does not return model token usage. Keep token counts at
-- zero and price the provider request itself from immutable rate cards.

ALTER TABLE shared.ai_rate_cards
  ADD COLUMN IF NOT EXISTS billing_basis text NOT NULL DEFAULT 'tokens';

ALTER TABLE shared.ai_rate_cards
  ADD COLUMN IF NOT EXISTS request_usd_per_unit numeric(18,9) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ai_rate_cards_billing_basis_check'
       AND conrelid = 'shared.ai_rate_cards'::regclass
  ) THEN
    ALTER TABLE shared.ai_rate_cards
      ADD CONSTRAINT ai_rate_cards_billing_basis_check
      CHECK (billing_basis IN ('tokens', 'request'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ai_rate_cards_request_rate_check'
       AND conrelid = 'shared.ai_rate_cards'::regclass
  ) THEN
    ALTER TABLE shared.ai_rate_cards
      ADD CONSTRAINT ai_rate_cards_request_rate_check
      CHECK (
        (billing_basis = 'tokens' AND request_usd_per_unit IS NULL)
        OR
        (billing_basis = 'request' AND request_usd_per_unit IS NOT NULL AND request_usd_per_unit >= 0)
      );
  END IF;
END;
$$;

INSERT INTO shared.ai_rate_cards (
  id, provider, model, service_tier, input_modality, version,
  input_usd_per_million, cached_input_usd_per_million, output_usd_per_million,
  long_context_threshold_tokens, long_input_usd_per_million,
  long_cached_input_usd_per_million, long_output_usd_per_million,
  effective_from, source_reference, billing_basis, request_usd_per_unit
) VALUES
  (
    'google.dialogflow-cx-flow-text.standard.2026-08-25',
    'google', 'dialogflow-cx-flow-text', 'standard', 'text', '2026-08-25',
    0, 0, 0,
    NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00Z',
    'https://cloud.google.com/products/conversational-agents/pricing',
    'request', 0.007
  ),
  (
    'google.dialogflow-cx-playbook-text.standard.2026-08-25',
    'google', 'dialogflow-cx-playbook-text', 'standard', 'text', '2026-08-25',
    0, 0, 0,
    NULL, NULL, NULL, NULL,
    '2026-08-25T00:00:00Z',
    'https://cloud.google.com/products/conversational-agents/pricing',
    'request', 0.012
  )
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION shared.apply_ai_request_billing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rate_basis text;
  request_rate numeric(18,9);
  request_count_text text;
  billing_unit text;
  request_class text;
BEGIN
  SELECT billing_basis, request_usd_per_unit
    INTO rate_basis, request_rate
    FROM shared.ai_rate_cards
   WHERE id = NEW.rate_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI rate card missing for usage event';
  END IF;

  IF rate_basis <> 'request' THEN
    RETURN NEW;
  END IF;

  IF NEW.prompt_tokens <> 0
     OR NEW.cached_tokens <> 0
     OR NEW.output_tokens <> 0
     OR NEW.thinking_tokens <> 0
     OR NEW.tool_use_prompt_tokens <> 0
     OR NEW.total_tokens <> 0 THEN
    RAISE EXCEPTION 'Request-priced AI usage must not invent token counts';
  END IF;

  request_count_text := NEW.provider_usage_metadata ->> 'requestCount';
  billing_unit := NEW.provider_usage_metadata ->> 'billingUnit';
  request_class := NEW.provider_usage_metadata ->> 'requestClass';

  IF request_count_text IS NULL OR request_count_text !~ '^[1-9][0-9]*$' THEN
    RAISE EXCEPTION 'Request-priced AI usage requires provider request count';
  END IF;
  IF request_count_text::bigint <> 1 THEN
    RAISE EXCEPTION 'Each AI usage event must represent exactly one provider request';
  END IF;
  IF billing_unit <> 'text-request' THEN
    RAISE EXCEPTION 'Unexpected Dialogflow CX billing unit';
  END IF;
  IF NEW.model = 'dialogflow-cx-flow-text' AND request_class <> 'flow' THEN
    RAISE EXCEPTION 'Dialogflow CX flow request class mismatch';
  END IF;
  IF NEW.model = 'dialogflow-cx-playbook-text' AND request_class <> 'playbook' THEN
    RAISE EXCEPTION 'Dialogflow CX playbook request class mismatch';
  END IF;

  NEW.usage_usd := (request_count_text::numeric * request_rate)::numeric(18,9);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_usage_events_request_billing ON shared.ai_usage_events;
CREATE TRIGGER ai_usage_events_request_billing
BEFORE INSERT ON shared.ai_usage_events
FOR EACH ROW EXECUTE FUNCTION shared.apply_ai_request_billing();