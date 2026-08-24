BEGIN;

ALTER TABLE shared.ai_usage_events
  DROP CONSTRAINT IF EXISTS ai_usage_events_customer_attribution;

ALTER TABLE shared.ai_usage_events
  ADD CONSTRAINT ai_usage_events_customer_attribution CHECK (
    (source = 'admin' AND customer_id IS NULL)
    OR source = 'website'
    OR (source = 'ordering' AND customer_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT ai_usage_events_customer_attribution ON shared.ai_usage_events IS
  'Admin usage is internal, Website usage may be anonymous or customer-attributed, and Ordering usage must be customer-attributed.';

COMMIT;
