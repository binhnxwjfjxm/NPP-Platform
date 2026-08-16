-- Issue #562 Part 4: controlled selective business-data purge metadata and audit purge guard.
-- Purge execution remains application-controlled; this migration never deletes business data.

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

-- Audit stays append-only for ordinary application traffic. The only DELETE exception is
-- the same database transaction that has already moved a deletion intent to PURGING for
-- the audit row's installation. PURGING is never an externally committed intermediate
-- state in the application purge flow, so concurrent sessions cannot use this exception.
CREATE OR REPLACE FUNCTION shared.prevent_core_audit_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND EXISTS (
       SELECT 1
       FROM shared.data_deletion_intents intent
       WHERE intent.installation_id = OLD.installation_id
         AND intent.status = 'PURGING'
     ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'core_audit_records_are_append_only';
END;
$$;
