-- Phase 6E.4 hardening: delivery-attempt outbox scheduling must never trust driver time.
-- attempted_at remains the business occurrence timestamp; outbox scheduling is server-owned.

CREATE OR REPLACE FUNCTION logistics.enforce_delivery_attempt_outbox_schedule()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trusted_now timestamptz := statement_timestamp();
BEGIN
  IF NEW.event_type = 'core.delivery_attempt.recorded' THEN
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
