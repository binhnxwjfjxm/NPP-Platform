-- Phase 6E.1: logistics master data and trip planning only.
-- No dispatch, Inventory OUT, delivery attempt, POD, COD or production operation is introduced here.

CREATE SCHEMA IF NOT EXISTS logistics;

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.logistics-route.read', 'Điều phối giao hàng', 'Xem tuyến giao hàng', 'Cho phép đọc tuyến giao hàng trong installation hiện tại.', true, now()),
  ('core.logistics-route.manage', 'Điều phối giao hàng', 'Quản lý tuyến giao hàng', 'Cho phép tạo tuyến giao hàng phục vụ lập kế hoạch chuyến.', true, now()),
  ('core.vehicle.read', 'Điều phối giao hàng', 'Xem phương tiện', 'Cho phép đọc danh mục phương tiện giao hàng.', true, now()),
  ('core.vehicle.manage', 'Điều phối giao hàng', 'Quản lý phương tiện', 'Cho phép tạo phương tiện giao hàng phục vụ điều phối.', true, now()),
  ('core.driver-profile.read', 'Điều phối giao hàng', 'Xem tài xế', 'Cho phép đọc hồ sơ tài xế giao hàng.', true, now()),
  ('core.driver-profile.manage', 'Điều phối giao hàng', 'Quản lý tài xế', 'Cho phép tạo hồ sơ tài xế giao hàng.', true, now()),
  ('core.delivery-trip.read', 'Điều phối giao hàng', 'Xem chuyến giao', 'Cho phép đọc chuyến, điểm dừng và phiếu giao được gán trong phạm vi kho.', true, now()),
  ('core.delivery-trip.create', 'Điều phối giao hàng', 'Tạo chuyến giao', 'Cho phép tạo chuyến giao nháp trong phạm vi kho.', true, now()),
  ('core.delivery-trip.plan', 'Điều phối giao hàng', 'Lập kế hoạch chuyến', 'Cho phép cập nhật xe, tài xế, thời gian và trạng thái planned của chuyến.', true, now()),
  ('core.delivery-trip.assign', 'Điều phối giao hàng', 'Gán phiếu giao vào chuyến', 'Cho phép gán, bỏ gán và xếp thứ tự điểm dừng trước khi khóa.', true, now()),
  ('core.delivery-trip.lock', 'Điều phối giao hàng', 'Khóa kế hoạch chuyến', 'Cho phép khóa kế hoạch chuyến đã đủ xe, tài xế và phiếu giao.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS logistics.delivery_routes (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 64),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  default_warehouse_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_routes_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_routes_code_unique UNIQUE (installation_id, code),
  CONSTRAINT delivery_routes_warehouse_fk
    FOREIGN KEY (installation_id, default_warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS logistics.vehicles (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 64),
  license_plate text NOT NULL CHECK (char_length(btrim(license_plate)) BETWEEN 1 AND 32),
  vehicle_type text NOT NULL CHECK (char_length(btrim(vehicle_type)) BETWEEN 1 AND 80),
  capacity_weight numeric(30,12) NULL CHECK (capacity_weight IS NULL OR capacity_weight > 0),
  capacity_volume numeric(30,12) NULL CHECK (capacity_volume IS NULL OR capacity_volume > 0),
  operational_status text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (operational_status IN ('AVAILABLE', 'MAINTENANCE', 'INACTIVE')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT vehicles_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT vehicles_code_unique UNIQUE (installation_id, code),
  CONSTRAINT vehicles_plate_unique UNIQUE (installation_id, license_plate)
);

CREATE TABLE IF NOT EXISTS logistics.driver_profiles (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 64),
  employee_id uuid NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  phone text NULL CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 1 AND 32),
  license_reference text NULL CHECK (license_reference IS NULL OR char_length(btrim(license_reference)) <= 128),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT driver_profiles_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT driver_profiles_code_unique UNIQUE (installation_id, code)
);

CREATE TABLE IF NOT EXISTS logistics.trip_number_counters (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  business_date date NOT NULL,
  last_value bigint NOT NULL CHECK (last_value >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, business_date)
);

CREATE TABLE IF NOT EXISTS logistics.delivery_trips (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  trip_number text NOT NULL CHECK (char_length(btrim(trip_number)) BETWEEN 1 AND 80),
  warehouse_id uuid NOT NULL,
  delivery_route_id uuid NULL,
  vehicle_id uuid NULL,
  primary_driver_id uuid NULL,
  planned_start_at timestamptz NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'locked')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  create_idempotency_key text NOT NULL CHECK (char_length(create_idempotency_key) BETWEEN 1 AND 128),
  create_payload_hash text NOT NULL CHECK (create_payload_hash ~ '^[0-9a-f]{64}$'),
  planned_at timestamptz NULL,
  planned_by text NULL CHECK (planned_by IS NULL OR char_length(planned_by) BETWEEN 1 AND 128),
  reopened_at timestamptz NULL,
  reopened_by text NULL CHECK (reopened_by IS NULL OR char_length(reopened_by) BETWEEN 1 AND 128),
  reopen_reason text NULL CHECK (reopen_reason IS NULL OR char_length(btrim(reopen_reason)) BETWEEN 1 AND 1000),
  locked_at timestamptz NULL,
  locked_by text NULL CHECK (locked_by IS NULL OR char_length(locked_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_trips_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_trips_number_unique UNIQUE (installation_id, trip_number),
  CONSTRAINT delivery_trips_create_idempotency_unique UNIQUE (installation_id, create_idempotency_key),
  CONSTRAINT delivery_trips_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_trips_route_fk
    FOREIGN KEY (installation_id, delivery_route_id)
    REFERENCES logistics.delivery_routes (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_trips_vehicle_fk
    FOREIGN KEY (installation_id, vehicle_id)
    REFERENCES logistics.vehicles (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_trips_driver_fk
    FOREIGN KEY (installation_id, primary_driver_id)
    REFERENCES logistics.driver_profiles (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_trips_planned_shape CHECK (
    status = 'draft'
    OR (vehicle_id IS NOT NULL AND primary_driver_id IS NOT NULL AND planned_at IS NOT NULL AND planned_by IS NOT NULL)
  ),
  CONSTRAINT delivery_trips_locked_shape CHECK (
    status <> 'locked' OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS delivery_trips_queue_idx
  ON logistics.delivery_trips (installation_id, warehouse_id, status, planned_start_at, created_at, id);

CREATE TABLE IF NOT EXISTS logistics.trip_stops (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  trip_id uuid NOT NULL,
  stop_sequence integer NOT NULL CHECK (stop_sequence BETWEEN 1 AND 10000),
  customer_id uuid NOT NULL,
  customer_address_id uuid NOT NULL,
  address_snapshot jsonb NOT NULL CHECK (jsonb_typeof(address_snapshot) = 'object'),
  planned_arrival_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT trip_stops_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT trip_stops_sequence_unique UNIQUE (installation_id, trip_id, stop_sequence),
  CONSTRAINT trip_stops_customer_address_unique UNIQUE (installation_id, trip_id, customer_id, customer_address_id),
  CONSTRAINT trip_stops_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_stops_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_stops_address_fk
    FOREIGN KEY (installation_id, customer_address_id)
    REFERENCES shared.customer_addresses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS logistics.trip_order_assignments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  trip_id uuid NOT NULL,
  trip_stop_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by text NOT NULL CHECK (char_length(assigned_by) BETWEEN 1 AND 128),
  unassigned_at timestamptz NULL,
  unassigned_by text NULL CHECK (unassigned_by IS NULL OR char_length(unassigned_by) BETWEEN 1 AND 128),
  unassignment_reason text NULL CHECK (
    unassignment_reason IS NULL OR char_length(btrim(unassignment_reason)) BETWEEN 1 AND 1000
  ),
  CONSTRAINT trip_order_assignments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT trip_order_assignments_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_order_assignments_stop_fk
    FOREIGN KEY (installation_id, trip_stop_id)
    REFERENCES logistics.trip_stops (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_order_assignments_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_order_assignments_unassigned_shape CHECK (
    unassigned_at IS NULL
    OR (unassigned_by IS NOT NULL AND unassignment_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS trip_order_assignments_active_delivery_order_unique
  ON logistics.trip_order_assignments (installation_id, delivery_order_id)
  WHERE unassigned_at IS NULL;
CREATE INDEX IF NOT EXISTS trip_order_assignments_trip_idx
  ON logistics.trip_order_assignments (installation_id, trip_id, trip_stop_id, assigned_at, id)
  WHERE unassigned_at IS NULL;

CREATE TABLE IF NOT EXISTS logistics.trip_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  trip_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'REORDERED', 'PLANNED', 'REOPENED', 'LOCKED'
  )),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_events_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT trip_events_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT trip_events_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS logistics.trip_operation_idempotency (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  operation_type text NOT NULL CHECK (char_length(operation_type) BETWEEN 1 AND 80),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  trip_id uuid NOT NULL,
  response_snapshot jsonb NOT NULL CHECK (jsonb_typeof(response_snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT trip_operation_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT trip_operation_idempotency_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION logistics.guard_trip_header_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'trip_planning_service' THEN
    RAISE EXCEPTION 'logistics_trip_write_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'logistics_trip_delete_forbidden';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'locked' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'logistics_trip_locked';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.trip_number IS DISTINCT FROM OLD.trip_number
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
       OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'logistics_trip_immutable_fields_changed';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status = 'draft' AND NEW.status = 'planned')
        OR (OLD.status = 'planned' AND NEW.status = 'draft')
        OR (OLD.status = 'planned' AND NEW.status = 'locked')
      ) THEN
        RAISE EXCEPTION 'logistics_trip_invalid_transition';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_trips_write_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_trips
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_header_write();

CREATE OR REPLACE FUNCTION logistics.guard_trip_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  target_trip_id uuid;
  target_installation_id text;
  trip_record logistics.delivery_trips;
BEGIN
  IF write_context IS DISTINCT FROM 'trip_planning_service' THEN
    RAISE EXCEPTION 'logistics_trip_child_write_requires_service_context';
  END IF;
  target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
  target_installation_id := COALESCE(NEW.installation_id, OLD.installation_id);
  SELECT * INTO trip_record
    FROM logistics.delivery_trips
   WHERE installation_id = target_installation_id AND id = target_trip_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'logistics_trip_not_found';
  END IF;
  IF trip_record.status = 'locked' THEN
    RAISE EXCEPTION 'logistics_trip_locked';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trip_stops_write_guard ON logistics.trip_stops;
CREATE TRIGGER trip_stops_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_stops
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_child_write();

DROP TRIGGER IF EXISTS trip_order_assignments_write_guard ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_order_assignments
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_child_write();

CREATE OR REPLACE FUNCTION logistics.guard_assignment_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  trip_record logistics.delivery_trips;
  stop_record logistics.trip_stops;
  delivery_record sales.delivery_orders;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.unassigned_at IS NULL THEN
    SELECT * INTO trip_record
      FROM logistics.delivery_trips
     WHERE installation_id = NEW.installation_id AND id = NEW.trip_id
     FOR UPDATE;
    SELECT * INTO stop_record
      FROM logistics.trip_stops
     WHERE installation_id = NEW.installation_id AND id = NEW.trip_stop_id;
    SELECT * INTO delivery_record
      FROM sales.delivery_orders
     WHERE installation_id = NEW.installation_id AND id = NEW.delivery_order_id
     FOR UPDATE;
    IF trip_record IS NULL OR stop_record IS NULL OR delivery_record IS NULL THEN
      RAISE EXCEPTION 'logistics_assignment_lineage_not_found';
    END IF;
    IF stop_record.trip_id IS DISTINCT FROM trip_record.id
       OR delivery_record.handover_mode <> 'DELIVERY'
       OR delivery_record.status <> 'ready_to_dispatch'
       OR delivery_record.warehouse_id IS DISTINCT FROM trip_record.warehouse_id
       OR stop_record.customer_id IS DISTINCT FROM delivery_record.customer_id
       OR stop_record.customer_address_id IS DISTINCT FROM delivery_record.customer_address_id THEN
      RAISE EXCEPTION 'logistics_assignment_lineage_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_order_assignments_lineage_guard ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_lineage_guard
BEFORE INSERT OR UPDATE ON logistics.trip_order_assignments
FOR EACH ROW EXECUTE FUNCTION logistics.guard_assignment_lineage();

CREATE OR REPLACE FUNCTION logistics.guard_trip_transition_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  vehicle_record logistics.vehicles;
  driver_record logistics.driver_profiles;
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

DROP TRIGGER IF EXISTS delivery_trips_transition_shape_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_transition_shape_guard
BEFORE UPDATE ON logistics.delivery_trips
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_transition_shape();
