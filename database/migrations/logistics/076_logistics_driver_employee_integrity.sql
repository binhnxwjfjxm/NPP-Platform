-- Issue #497 G4: canonical employee linkage for active logistics drivers.
-- Existing legacy rows are not rewritten here. New/changed active profiles are enforced immediately.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'driver_profiles_employee_fk'
       AND conrelid = 'logistics.driver_profiles'::regclass
  ) THEN
    ALTER TABLE logistics.driver_profiles
      ADD CONSTRAINT driver_profiles_employee_fk
      FOREIGN KEY (installation_id, employee_id)
      REFERENCES shared.employees (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS driver_profiles_employee_lookup_idx
  ON logistics.driver_profiles (installation_id, employee_id, is_active)
  WHERE employee_id IS NOT NULL;

CREATE OR REPLACE FUNCTION logistics.guard_driver_employee_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  employee_record shared.employees;
  duplicate_id uuid;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  IF NEW.employee_id IS NULL THEN
    RAISE EXCEPTION 'logistics_driver_employee_required';
  END IF;

  -- Serialize competing attempts to activate/create a profile for the same employee
  -- without requiring a unique index that could fail on untouched legacy duplicates.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.installation_id || ':' || NEW.employee_id::text, 0)
  );

  SELECT * INTO employee_record
    FROM shared.employees
   WHERE installation_id = NEW.installation_id
     AND id = NEW.employee_id
   FOR SHARE;

  IF employee_record IS NULL OR NOT employee_record.is_active THEN
    RAISE EXCEPTION 'logistics_driver_employee_not_available';
  END IF;

  SELECT id INTO duplicate_id
    FROM logistics.driver_profiles
   WHERE installation_id = NEW.installation_id
     AND employee_id = NEW.employee_id
     AND is_active
     AND id IS DISTINCT FROM NEW.id
   LIMIT 1;

  IF duplicate_id IS NOT NULL THEN
    RAISE EXCEPTION 'logistics_driver_employee_already_linked';
  END IF;

  -- Employee identity is canonical. Browser-provided copies cannot diverge.
  NEW.code := employee_record.code;
  NEW.name := employee_record.full_name;
  NEW.phone := employee_record.phone;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_profiles_employee_guard ON logistics.driver_profiles;
CREATE TRIGGER driver_profiles_employee_guard
BEFORE INSERT OR UPDATE OF employee_id, is_active, code, name, phone
ON logistics.driver_profiles
FOR EACH ROW EXECUTE FUNCTION logistics.guard_driver_employee_link();

CREATE OR REPLACE FUNCTION logistics.guard_trip_transition_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  vehicle_record logistics.vehicles;
  driver_record logistics.driver_profiles;
  employee_record shared.employees;
  assignment_count bigint;
  invalid_assignment_count bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('planned', 'locked') AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT * INTO vehicle_record
      FROM logistics.vehicles
     WHERE installation_id = NEW.installation_id AND id = NEW.vehicle_id;
    SELECT * INTO driver_record
      FROM logistics.driver_profiles
     WHERE installation_id = NEW.installation_id AND id = NEW.primary_driver_id;
    IF vehicle_record IS NULL OR NOT vehicle_record.is_active OR vehicle_record.operational_status <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'logistics_vehicle_not_available';
    END IF;
    IF driver_record IS NULL OR NOT driver_record.is_active THEN
      RAISE EXCEPTION 'logistics_driver_not_available';
    END IF;
    IF driver_record.employee_id IS NULL THEN
      RAISE EXCEPTION 'logistics_driver_employee_not_available';
    END IF;
    SELECT * INTO employee_record
      FROM shared.employees
     WHERE installation_id = NEW.installation_id
       AND id = driver_record.employee_id;
    IF employee_record IS NULL OR NOT employee_record.is_active THEN
      RAISE EXCEPTION 'logistics_driver_employee_not_available';
    END IF;
    SELECT count(*) INTO assignment_count
      FROM logistics.trip_order_assignments
     WHERE installation_id = NEW.installation_id
       AND trip_id = NEW.id
       AND unassigned_at IS NULL;
    IF assignment_count = 0 THEN
      RAISE EXCEPTION 'logistics_trip_assignment_required';
    END IF;
    SELECT count(*) INTO invalid_assignment_count
      FROM logistics.trip_order_assignments assignment
      JOIN sales.delivery_orders delivery_order
        ON delivery_order.installation_id = assignment.installation_id
       AND delivery_order.id = assignment.delivery_order_id
     WHERE assignment.installation_id = NEW.installation_id
       AND assignment.trip_id = NEW.id
       AND assignment.unassigned_at IS NULL
       AND (
         delivery_order.status <> 'ready_to_dispatch'
         OR delivery_order.handover_mode <> 'DELIVERY'
         OR delivery_order.warehouse_id IS DISTINCT FROM NEW.warehouse_id
       );
    IF invalid_assignment_count > 0 THEN
      RAISE EXCEPTION 'logistics_trip_contains_ineligible_delivery_order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
