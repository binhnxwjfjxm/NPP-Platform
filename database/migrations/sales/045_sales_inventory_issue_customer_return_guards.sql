-- Guard and compatibility block for migration 045. This file is concatenated into the
-- same registered migration ID; it is not a follow-up migration.

CREATE OR REPLACE FUNCTION inventory.guard_inventory_balance_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_balance_write_context', true);
BEGIN
  IF write_context IS NULL
     OR write_context NOT IN ('projector', 'rebuild', 'reservation', 'reservation_issue') THEN
    RAISE EXCEPTION 'inventory_balance_write_requires_projector';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_order_write_context', true);
  header_record sales.delivery_orders;
  allocation_record sales.sales_order_fulfillment_allocations;
  demand_record sales.sales_order_fulfillment_demands;
  claimed_quantity numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_order_service' THEN
    RAISE EXCEPTION 'delivery_order_line_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_order_lines_are_immutable';
  END IF;
  SELECT * INTO header_record
    FROM sales.delivery_orders
   WHERE installation_id = NEW.installation_id AND id = NEW.delivery_order_id
   FOR UPDATE;
  IF NOT FOUND OR header_record.status <> 'draft' THEN
    RAISE EXCEPTION 'delivery_order_draft_required';
  END IF;
  SELECT * INTO allocation_record
    FROM sales.sales_order_fulfillment_allocations
   WHERE installation_id = NEW.installation_id AND id = NEW.fulfillment_allocation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_order_allocation_not_found';
  END IF;
  SELECT * INTO demand_record
    FROM sales.sales_order_fulfillment_demands
   WHERE installation_id = allocation_record.installation_id
     AND id = allocation_record.fulfillment_demand_id
     AND state = 'ACTIVE';
  IF NOT FOUND
     OR allocation_record.packed_base_quantity <= 0
     OR NEW.sales_order_id IS DISTINCT FROM header_record.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM header_record.sales_order_version_id
     OR NEW.warehouse_id IS DISTINCT FROM header_record.warehouse_id
     OR NEW.sales_order_id IS DISTINCT FROM allocation_record.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM allocation_record.sales_order_version_id
     OR NEW.sales_order_line_id IS DISTINCT FROM allocation_record.sales_order_line_id
     OR NEW.fulfillment_demand_id IS DISTINCT FROM allocation_record.fulfillment_demand_id
     OR NEW.inventory_reservation_id IS DISTINCT FROM allocation_record.inventory_reservation_id
     OR NEW.warehouse_id IS DISTINCT FROM allocation_record.warehouse_id
     OR NEW.location_id IS DISTINCT FROM allocation_record.location_id
     OR NEW.base_variant_id IS DISTINCT FROM allocation_record.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM allocation_record.lot_id THEN
    RAISE EXCEPTION 'delivery_order_lineage_mismatch';
  END IF;
  SELECT COALESCE(sum(line.delivery_base_quantity), 0)
    INTO claimed_quantity
    FROM sales.delivery_order_lines line
    JOIN sales.delivery_orders header
      ON header.installation_id = line.installation_id
     AND header.id = line.delivery_order_id
   WHERE line.installation_id = NEW.installation_id
     AND line.fulfillment_allocation_id = NEW.fulfillment_allocation_id
     AND header.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over');
  IF claimed_quantity + NEW.delivery_base_quantity > allocation_record.packed_base_quantity THEN
    RAISE EXCEPTION 'delivery_order_quantity_exceeds_unclaimed_packed';
  END IF;
  NEW.packed_base_quantity_snapshot := allocation_record.packed_base_quantity;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_event_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_order_write_context', true);
BEGIN
  IF write_context NOT IN ('delivery_order_service', 'delivery_issue_service') THEN
    RAISE EXCEPTION 'delivery_order_event_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_order_events_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sales.guard_delivery_issue_header_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_issue_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_issue_service' THEN
    RAISE EXCEPTION 'delivery_issue_header_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery_issue_headers_cannot_be_deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'POSTING'
       OR NEW.inventory_movement_id IS NOT NULL
       OR NEW.inventory_reversal_movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'delivery_issue_must_start_posting';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.delivery_order_id IS DISTINCT FROM OLD.delivery_order_id
     OR NEW.issue_source_type IS DISTINCT FROM OLD.issue_source_type
     OR NEW.issue_source_id IS DISTINCT FROM OLD.issue_source_id
     OR NEW.receiver_name IS DISTINCT FROM OLD.receiver_name
     OR NEW.receiver_note IS DISTINCT FROM OLD.receiver_note
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'delivery_issue_immutable_fields_changed';
  END IF;
  IF OLD.status = 'POSTING' AND NEW.status = 'POSTED' THEN
    IF NEW.inventory_movement_id IS NULL
       OR NEW.posted_at IS NULL
       OR NEW.posted_by IS NULL
       OR NEW.inventory_reversal_movement_id IS NOT NULL THEN
      RAISE EXCEPTION 'delivery_issue_posted_shape_invalid';
    END IF;
  ELSIF OLD.status = 'POSTED' AND NEW.status = 'REVERSED' THEN
    IF NEW.inventory_movement_id IS DISTINCT FROM OLD.inventory_movement_id
       OR NEW.inventory_reversal_movement_id IS NULL
       OR NEW.reversed_at IS NULL
       OR NEW.reversed_by IS NULL
       OR NEW.reversal_reason IS NULL THEN
      RAISE EXCEPTION 'delivery_issue_reversed_shape_invalid';
    END IF;
  ELSIF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'delivery_issue_invalid_transition';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_order_inventory_issues_write_guard
  ON sales.delivery_order_inventory_issues;
CREATE TRIGGER delivery_order_inventory_issues_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_order_inventory_issues
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_issue_header_write();

CREATE OR REPLACE FUNCTION sales.guard_delivery_issue_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_issue_write_context', true);
  source_line sales.delivery_order_lines;
  issue_record sales.delivery_order_inventory_issues;
  movement_line inventory.inventory_movement_lines;
  active_total numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_issue_service' THEN
    RAISE EXCEPTION 'delivery_issue_line_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery_issue_lines_are_immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.issue_id IS DISTINCT FROM OLD.issue_id
       OR NEW.delivery_order_id IS DISTINCT FROM OLD.delivery_order_id
       OR NEW.delivery_order_line_id IS DISTINCT FROM OLD.delivery_order_line_id
       OR NEW.fulfillment_demand_id IS DISTINCT FROM OLD.fulfillment_demand_id
       OR NEW.fulfillment_allocation_id IS DISTINCT FROM OLD.fulfillment_allocation_id
       OR NEW.inventory_reservation_id IS DISTINCT FROM OLD.inventory_reservation_id
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
       OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
       OR NEW.issued_base_quantity IS DISTINCT FROM OLD.issued_base_quantity
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR OLD.inventory_movement_line_id IS NOT NULL
       OR NEW.inventory_movement_line_id IS NULL THEN
      RAISE EXCEPTION 'delivery_issue_lines_are_immutable';
    END IF;
    SELECT * INTO issue_record
      FROM sales.delivery_order_inventory_issues
     WHERE installation_id = NEW.installation_id AND id = NEW.issue_id;
    SELECT * INTO movement_line
      FROM inventory.inventory_movement_lines
     WHERE installation_id = NEW.installation_id AND id = NEW.inventory_movement_line_id;
    IF issue_record IS NULL OR issue_record.status <> 'POSTING'
       OR movement_line IS NULL
       OR movement_line.source_line_reference IS DISTINCT FROM NEW.id::text
       OR movement_line.warehouse_id IS DISTINCT FROM NEW.warehouse_id
       OR movement_line.location_id IS DISTINCT FROM NEW.location_id
       OR movement_line.base_variant_id IS DISTINCT FROM NEW.base_variant_id
       OR movement_line.lot_id IS DISTINCT FROM NEW.lot_id
       OR abs(movement_line.base_quantity_delta) IS DISTINCT FROM NEW.issued_base_quantity THEN
      RAISE EXCEPTION 'delivery_issue_movement_line_mismatch';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO issue_record
    FROM sales.delivery_order_inventory_issues
   WHERE installation_id = NEW.installation_id AND id = NEW.issue_id
   FOR UPDATE;
  SELECT * INTO source_line
    FROM sales.delivery_order_lines
   WHERE installation_id = NEW.installation_id AND id = NEW.delivery_order_line_id;
  IF issue_record IS NULL OR issue_record.status <> 'POSTING' OR source_line IS NULL
     OR issue_record.delivery_order_id IS DISTINCT FROM NEW.delivery_order_id
     OR source_line.delivery_order_id IS DISTINCT FROM NEW.delivery_order_id
     OR source_line.fulfillment_demand_id IS DISTINCT FROM NEW.fulfillment_demand_id
     OR source_line.fulfillment_allocation_id IS DISTINCT FROM NEW.fulfillment_allocation_id
     OR source_line.inventory_reservation_id IS DISTINCT FROM NEW.inventory_reservation_id
     OR source_line.warehouse_id IS DISTINCT FROM NEW.warehouse_id
     OR source_line.location_id IS DISTINCT FROM NEW.location_id
     OR source_line.base_variant_id IS DISTINCT FROM NEW.base_variant_id
     OR source_line.lot_id IS DISTINCT FROM NEW.lot_id THEN
    RAISE EXCEPTION 'delivery_issue_lineage_mismatch';
  END IF;
  SELECT COALESCE(sum(line.issued_base_quantity), 0)
    INTO active_total
    FROM sales.delivery_order_inventory_issue_lines line
    JOIN sales.delivery_order_inventory_issues issue
      ON issue.installation_id = line.installation_id AND issue.id = line.issue_id
   WHERE line.installation_id = NEW.installation_id
     AND line.delivery_order_line_id = NEW.delivery_order_line_id
     AND issue.status IN ('POSTING', 'POSTED');
  IF active_total + NEW.issued_base_quantity > source_line.delivery_base_quantity THEN
    RAISE EXCEPTION 'delivery_issue_exceeds_delivery_order_line';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sales.guard_customer_return_header_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.customer_return_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'customer_return_service' THEN
    RAISE EXCEPTION 'customer_return_header_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'customer_returns_cannot_be_deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'customer_return_must_start_draft';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
     OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'customer_return_immutable_fields_changed';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'received' THEN
    IF NEW.return_number IS NULL OR NEW.return_number_allocation_id IS NULL
       OR NEW.inventory_movement_id IS NULL OR NEW.received_at IS NULL OR NEW.received_by IS NULL THEN
      RAISE EXCEPTION 'customer_return_received_shape_invalid';
    END IF;
  ELSIF OLD.status = 'draft' AND NEW.status = 'cancelled' THEN
    IF NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL OR NEW.cancellation_reason IS NULL THEN
      RAISE EXCEPTION 'customer_return_cancelled_shape_invalid';
    END IF;
  ELSIF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'customer_return_invalid_transition';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_returns_write_guard ON sales.customer_returns;
CREATE TRIGGER customer_returns_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.customer_returns
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_header_write();

CREATE OR REPLACE FUNCTION sales.guard_customer_return_event_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.customer_return_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'customer_return_service' THEN
    RAISE EXCEPTION 'customer_return_event_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'customer_return_events_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_return_events_write_guard ON sales.customer_return_events;
CREATE TRIGGER customer_return_events_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.customer_return_events
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_event_write();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customer_return_lines_customer_fk'
       AND conrelid = 'sales.customer_return_lines'::regclass
  ) THEN
    ALTER TABLE sales.customer_return_lines
      ADD CONSTRAINT customer_return_lines_customer_fk
      FOREIGN KEY (installation_id, customer_id)
      REFERENCES shared.customers (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customer_return_lines_warehouse_fk'
       AND conrelid = 'sales.customer_return_lines'::regclass
  ) THEN
    ALTER TABLE sales.customer_return_lines
      ADD CONSTRAINT customer_return_lines_warehouse_fk
      FOREIGN KEY (installation_id, warehouse_id)
      REFERENCES shared.warehouses (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customer_return_lines_location_fk'
       AND conrelid = 'sales.customer_return_lines'::regclass
  ) THEN
    ALTER TABLE sales.customer_return_lines
      ADD CONSTRAINT customer_return_lines_location_fk
      FOREIGN KEY (installation_id, warehouse_id, location_id)
      REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customer_return_lines_variant_fk'
       AND conrelid = 'sales.customer_return_lines'::regclass
  ) THEN
    ALTER TABLE sales.customer_return_lines
      ADD CONSTRAINT customer_return_lines_variant_fk
      FOREIGN KEY (installation_id, base_variant_id)
      REFERENCES shared.product_variants (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'customer_return_lines_lot_fk'
       AND conrelid = 'sales.customer_return_lines'::regclass
  ) THEN
    ALTER TABLE sales.customer_return_lines
      ADD CONSTRAINT customer_return_lines_lot_fk
      FOREIGN KEY (installation_id, lot_id)
      REFERENCES inventory.inventory_lots (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;
