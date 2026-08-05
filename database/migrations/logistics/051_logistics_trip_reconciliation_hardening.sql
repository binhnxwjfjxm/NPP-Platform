-- Phase 6E.5 hardening: business timestamps may come from operations,
-- but outbox scheduling must remain server-owned.

CREATE OR REPLACE FUNCTION logistics.enforce_delivery_attempt_outbox_schedule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trusted_now timestamptz := statement_timestamp();
BEGIN
  IF NEW.event_type IN (
    'core.delivery_attempt.recorded',
    'core.delivery_trip.return_received',
    'core.delivery_trip.closed'
  ) THEN
    NEW.created_at := trusted_now;
    NEW.available_at := trusted_now;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_attempt_outbox_schedule_guard
  ON shared.core_outbox_events;
CREATE TRIGGER delivery_attempt_outbox_schedule_guard
BEFORE INSERT ON shared.core_outbox_events
FOR EACH ROW
EXECUTE FUNCTION logistics.enforce_delivery_attempt_outbox_schedule();
