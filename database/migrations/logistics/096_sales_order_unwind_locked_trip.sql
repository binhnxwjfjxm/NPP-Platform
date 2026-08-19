-- Issue #622: a Sales Order may be cancelled/changed before customer delivery even when
-- its trip has already been locked. The server-owned unwind may only reopen LOCKED -> draft
-- before dispatch, then unassign the affected Delivery Order. Dispatch history is never rewritten.

DROP TRIGGER IF EXISTS delivery_trips_write_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_trips
FOR EACH ROW
WHEN (
  current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'trip_recovery_service'
  AND current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'sales_order_unwind_service'
)
EXECUTE FUNCTION logistics.guard_trip_header_write();

CREATE OR REPLACE FUNCTION logistics.guard_sales_order_unwind_trip_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed_columns text[] := ARRAY[
    'status', 'reopened_at', 'reopened_by', 'reopen_reason',
    'revision', 'updated_at', 'updated_by'
  ];
BEGIN
  IF current_setting('npp.logistics_write_context', true)
       IS DISTINCT FROM 'sales_order_unwind_service' THEN
    RAISE EXCEPTION 'sales_order_unwind_trip_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'locked' OR NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'sales_order_unwind_trip_invalid_transition';
  END IF;
  IF OLD.dispatch_id IS NOT NULL OR OLD.dispatched_at IS NOT NULL THEN
    RAISE EXCEPTION 'sales_order_unwind_trip_already_dispatched';
  END IF;
  IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM (to_jsonb(OLD) - allowed_columns) THEN
    RAISE EXCEPTION 'sales_order_unwind_trip_history_immutable';
  END IF;
  IF NEW.reopened_at IS NULL
     OR NEW.reopened_by IS NULL
     OR NEW.reopen_reason IS NULL
     OR btrim(NEW.reopen_reason) = ''
     OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'sales_order_unwind_trip_reopen_fact_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_trips_sales_order_unwind_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_sales_order_unwind_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_trips
FOR EACH ROW
WHEN (current_setting('npp.logistics_write_context', true) = 'sales_order_unwind_service')
EXECUTE FUNCTION logistics.guard_sales_order_unwind_trip_write();

DROP TRIGGER IF EXISTS trip_order_assignments_write_guard ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_order_assignments
FOR EACH ROW
WHEN (
  current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'trip_recovery_service'
  AND current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'sales_order_unwind_service'
)
EXECUTE FUNCTION logistics.guard_trip_child_write();

CREATE OR REPLACE FUNCTION logistics.guard_sales_order_unwind_assignment_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  trip_record logistics.delivery_trips;
  allowed_columns text[] := ARRAY['unassigned_at', 'unassigned_by', 'unassignment_reason'];
BEGIN
  IF current_setting('npp.logistics_write_context', true)
       IS DISTINCT FROM 'sales_order_unwind_service' THEN
    RAISE EXCEPTION 'sales_order_unwind_assignment_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE'
     OR OLD.unassigned_at IS NOT NULL
     OR NEW.unassigned_at IS NULL
     OR NEW.unassigned_by IS NULL
     OR NEW.unassignment_reason IS NULL
     OR btrim(NEW.unassignment_reason) = '' THEN
    RAISE EXCEPTION 'sales_order_unwind_assignment_invalid';
  END IF;
  IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM (to_jsonb(OLD) - allowed_columns) THEN
    RAISE EXCEPTION 'sales_order_unwind_assignment_lineage_immutable';
  END IF;
  SELECT * INTO trip_record
    FROM logistics.delivery_trips
   WHERE installation_id = NEW.installation_id
     AND id = NEW.trip_id
   FOR UPDATE;
  IF NOT FOUND OR trip_record.status <> 'draft' OR trip_record.dispatch_id IS NOT NULL THEN
    RAISE EXCEPTION 'sales_order_unwind_assignment_requires_reopened_trip';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_order_assignments_sales_order_unwind_guard
  ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_sales_order_unwind_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_order_assignments
FOR EACH ROW
WHEN (current_setting('npp.logistics_write_context', true) = 'sales_order_unwind_service')
EXECUTE FUNCTION logistics.guard_sales_order_unwind_assignment_write();
