-- Durable terminal state for unresolved manual inbound confirmations.
-- Under the same PostgreSQL transaction advisory lock as canonical posting,
-- a cancelled request can never later post stock, even after network delays.
CREATE TABLE IF NOT EXISTS inventory.manual_inbound_confirmation_cancellations (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._-]+$'
  ),
  cancelled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  cancelled_by text NOT NULL CHECK (char_length(cancelled_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION inventory.prevent_manual_inbound_confirmation_cancellation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'manual_inbound_confirmation_cancellation_is_immutable';
END $$;

DROP TRIGGER IF EXISTS manual_inbound_confirmation_cancellations_append_only
  ON inventory.manual_inbound_confirmation_cancellations;
CREATE TRIGGER manual_inbound_confirmation_cancellations_append_only
  BEFORE UPDATE OR DELETE ON inventory.manual_inbound_confirmation_cancellations
  FOR EACH ROW EXECUTE FUNCTION inventory.prevent_manual_inbound_confirmation_cancellation_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END $$;
