-- Issue #562 Part 4: controlled selective business-data purge metadata.
-- Purge execution is application-controlled; this migration only persists target/result state.

ALTER TABLE shared.data_deletion_intents
  ADD COLUMN IF NOT EXISTS target_code text NOT NULL DEFAULT 'ALL_BUSINESS_DATA',
  ADD COLUMN IF NOT EXISTS purge_started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS purge_completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS purge_summary jsonb NULL;

ALTER TABLE shared.data_deletion_intents
  DROP CONSTRAINT IF EXISTS data_deletion_intents_status_check;
ALTER TABLE shared.data_deletion_intents
  ADD CONSTRAINT data_deletion_intents_status_check
  CHECK (status IN ('CHALLENGE_PENDING','AUTHORIZED','PURGING','PURGED','FAILED','CANCELLED'));

ALTER TABLE shared.data_deletion_intents
  DROP CONSTRAINT IF EXISTS data_deletion_intents_target_code_check;
ALTER TABLE shared.data_deletion_intents
  ADD CONSTRAINT data_deletion_intents_target_code_check
  CHECK (target_code IN (
    'ALL_BUSINESS_DATA',
    'OPERATIONS_ONLY',
    'CUSTOMERS_AND_SALES',
    'SUPPLIERS_AND_PURCHASING',
    'PRODUCTS_AND_INVENTORY',
    'MCP_ONLY'
  ));

ALTER TABLE shared.data_deletion_intents
  DROP CONSTRAINT IF EXISTS data_deletion_intents_purge_summary_check;
ALTER TABLE shared.data_deletion_intents
  ADD CONSTRAINT data_deletion_intents_purge_summary_check
  CHECK (purge_summary IS NULL OR jsonb_typeof(purge_summary) = 'object');

CREATE INDEX IF NOT EXISTS data_deletion_intents_purge_status_idx
  ON shared.data_deletion_intents (installation_id, status, created_at DESC);
