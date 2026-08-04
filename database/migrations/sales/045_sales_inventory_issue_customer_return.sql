-- Phase 6D.4: Delivery Order inventory issue/reversal and customer-return origin.
-- DELIVERY dispatch remains owned by Core Logistics. PICKUP physical handover may post
-- inventory directly through the server-owned Sales service. No accounting/POD/COD facts.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.delivery-order.issue-inventory', 'Giao nhận', 'Xuất kho theo điều phối giao hàng', 'Cho phép service điều phối được cấp quyền ghi Inventory OUT từ Delivery Order đã sẵn sàng.', true, now()),
  ('core.delivery-order.pickup-handover', 'Giao nhận', 'Xác nhận bàn giao tại quầy', 'Cho phép xác nhận bàn giao vật lý cho khách nhận tại quầy và ghi Inventory OUT.', true, now()),
  ('core.delivery-order.reverse-inventory-issue', 'Giao nhận', 'Đảo xuất kho giao nhận', 'Cho phép đảo một lần movement xuất kho sai khi chưa có dữ liệu downstream chặn.', true, now()),
  ('core.customer-return.read', 'Hàng khách trả', 'Xem hàng khách trả', 'Cho phép đọc nguồn hàng đã xuất và phiếu hàng khách trả trong phạm vi kho.', true, now()),
  ('core.customer-return.create', 'Hàng khách trả', 'Tạo phiếu hàng khách trả', 'Cho phép tạo phiếu nháp từ dòng Delivery Order đã xuất có nguồn gốc bất biến.', true, now()),
  ('core.customer-return.receive', 'Hàng khách trả', 'Nhận hàng khách trả vào kho', 'Cho phép xác nhận số lượng thực nhận và ghi Inventory IN.', true, now()),
  ('core.customer-return.cancel', 'Hàng khách trả', 'Hủy phiếu hàng khách trả nháp', 'Cho phép hủy phiếu nháp với lý do bắt buộc.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

-- Preserve exact 12-decimal quantities from fulfillment/Delivery Order in the ledger.
ALTER TABLE inventory.inventory_movement_lines
  ALTER COLUMN source_quantity TYPE numeric(30,12),
  ALTER COLUMN conversion_to_base TYPE numeric(30,12);

-- Partial issue consumes an exact reservation incrementally. The adjustment rows are
-- append-only history; reservation state becomes CONSUMED only at full consumption.
ALTER TABLE inventory.inventory_reservations
  ADD COLUMN IF NOT EXISTS consumed_quantity numeric(30,12) NOT NULL DEFAULT 0;

UPDATE inventory.inventory_reservations
   SET consumed_quantity = quantity
 WHERE state = 'CONSUMED'
   AND consumed_quantity = 0;

ALTER TABLE inventory.inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_consumed_quantity_check;
ALTER TABLE inventory.inventory_reservations
  ADD CONSTRAINT inventory_reservations_consumed_quantity_check
  CHECK (consumed_quantity >= 0 AND consumed_quantity <= quantity);

CREATE TABLE IF NOT EXISTS inventory.inventory_reservation_issue_adjustments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  reservation_id uuid NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('CONSUME', 'RESTORE')),
  quantity numeric(30,12) NOT NULL CHECK (quantity > 0),
  source_document_type text NOT NULL CHECK (
    char_length(source_document_type) BETWEEN 1 AND 64
    AND source_document_type = upper(btrim(source_document_type))
  ),
  source_document_id uuid NOT NULL,
  source_line_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservation_issue_adjustments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_reservation_issue_adjustments_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_reservation_issue_adjustments_reservation_fk
    FOREIGN KEY (installation_id, reservation_id)
    REFERENCES inventory.inventory_reservations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_reservation_issue_adjustments_reservation_idx
  ON inventory.inventory_reservation_issue_adjustments (
    installation_id, reservation_id, occurred_at, id
  );
CREATE INDEX IF NOT EXISTS inventory_reservation_issue_adjustments_source_idx
  ON inventory.inventory_reservation_issue_adjustments (
    installation_id, source_document_type, source_document_id, source_line_id
  );

CREATE OR REPLACE FUNCTION inventory.guard_reservation_issue_adjustment_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_issue_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_issue_service' THEN
    RAISE EXCEPTION 'inventory_reservation_issue_adjustment_requires_delivery_issue_service';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'inventory_reservation_issue_adjustments_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_issue_adjustments_write_guard
  ON inventory.inventory_reservation_issue_adjustments;
CREATE TRIGGER inventory_reservation_issue_adjustments_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_reservation_issue_adjustments
FOR EACH ROW EXECUTE FUNCTION inventory.guard_reservation_issue_adjustment_write();

CREATE OR REPLACE FUNCTION inventory.apply_reservation_issue_adjustment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_record inventory.inventory_reservations;
  previous_reservation_context text := current_setting('npp.inventory_reservation_write_context', true);
  previous_balance_context text := current_setting('npp.inventory_balance_write_context', true);
  next_consumed numeric(30,12);
  affected_rows integer;
BEGIN
  SELECT * INTO reservation_record
    FROM inventory.inventory_reservations
   WHERE installation_id = NEW.installation_id
     AND id = NEW.reservation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_reservation_not_found_for_issue_adjustment';
  END IF;

  PERFORM set_config('npp.inventory_reservation_write_context', 'delivery_issue_service', true);
  PERFORM set_config('npp.inventory_balance_write_context', 'reservation_issue', true);

  IF NEW.adjustment_type = 'CONSUME' THEN
    IF reservation_record.state NOT IN ('ACTIVE', 'CONSUMED')
       OR reservation_record.consumed_quantity + NEW.quantity > reservation_record.quantity THEN
      RAISE EXCEPTION 'inventory_reservation_issue_exceeds_remaining';
    END IF;

    UPDATE inventory.inventory_balances
       SET reserved_quantity = reserved_quantity - NEW.quantity,
           updated_at = now()
     WHERE installation_id = NEW.installation_id
       AND warehouse_id = reservation_record.warehouse_id
       AND location_id IS NOT DISTINCT FROM reservation_record.location_id
       AND base_variant_id = reservation_record.base_variant_id
       AND lot_id IS NOT DISTINCT FROM reservation_record.lot_id
       AND reserved_quantity >= NEW.quantity;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'inventory_reservation_balance_mismatch';
    END IF;

    next_consumed := reservation_record.consumed_quantity + NEW.quantity;
    UPDATE inventory.inventory_reservations
       SET consumed_quantity = next_consumed,
           state = CASE WHEN next_consumed = quantity THEN 'CONSUMED' ELSE 'ACTIVE' END,
           transitioned_at = NEW.occurred_at
     WHERE installation_id = NEW.installation_id
       AND id = NEW.reservation_id;
  ELSE
    IF reservation_record.state NOT IN ('ACTIVE', 'CONSUMED')
       OR reservation_record.consumed_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'inventory_reservation_restore_exceeds_consumed';
    END IF;

    INSERT INTO inventory.inventory_balances (
      installation_id, warehouse_id, location_id, base_variant_id, lot_id,
      on_hand_quantity, reserved_quantity, projected_through, updated_at
    ) VALUES (
      NEW.installation_id,
      reservation_record.warehouse_id,
      reservation_record.location_id,
      reservation_record.base_variant_id,
      reservation_record.lot_id,
      0,
      NEW.quantity,
      now(),
      now()
    )
    ON CONFLICT (installation_id, warehouse_id, location_id, base_variant_id, lot_id)
    DO UPDATE SET reserved_quantity = inventory.inventory_balances.reserved_quantity + EXCLUDED.reserved_quantity,
                  updated_at = now();

    next_consumed := reservation_record.consumed_quantity - NEW.quantity;
    UPDATE inventory.inventory_reservations
       SET consumed_quantity = next_consumed,
           state = CASE WHEN next_consumed < quantity THEN 'ACTIVE' ELSE 'CONSUMED' END,
           transitioned_at = NEW.occurred_at
     WHERE installation_id = NEW.installation_id
       AND id = NEW.reservation_id;
  END IF;

  PERFORM set_config('npp.inventory_reservation_write_context', COALESCE(previous_reservation_context, ''), true);
  PERFORM set_config('npp.inventory_balance_write_context', COALESCE(previous_balance_context, ''), true);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('npp.inventory_reservation_write_context', COALESCE(previous_reservation_context, ''), true);
    PERFORM set_config('npp.inventory_balance_write_context', COALESCE(previous_balance_context, ''), true);
    RAISE;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_issue_adjustments_apply
  ON inventory.inventory_reservation_issue_adjustments;
CREATE TRIGGER inventory_reservation_issue_adjustments_apply
AFTER INSERT ON inventory.inventory_reservation_issue_adjustments
FOR EACH ROW EXECUTE FUNCTION inventory.apply_reservation_issue_adjustment();

-- Extend reservation guard without weakening the existing service lifecycle.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context NOT IN ('reservation_service', 'delivery_issue_service') THEN
    RAISE EXCEPTION 'inventory_reservation_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_reservations_cannot_be_deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' OR NEW.consumed_quantity <> 0 THEN
      RAISE EXCEPTION 'inventory_reservation_must_start_active';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
     OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'inventory_reservation_immutable_fields_cannot_change';
  END IF;

  IF write_context = 'delivery_issue_service' THEN
    IF NEW.consumed_quantity < 0 OR NEW.consumed_quantity > NEW.quantity
       OR NEW.state NOT IN ('ACTIVE', 'CONSUMED')
       OR (NEW.state = 'CONSUMED' AND NEW.consumed_quantity <> NEW.quantity)
       OR (NEW.state = 'ACTIVE' AND NEW.consumed_quantity >= NEW.quantity) THEN
      RAISE EXCEPTION 'inventory_reservation_issue_state_mismatch';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.consumed_quantity IS DISTINCT FROM OLD.consumed_quantity THEN
    RAISE EXCEPTION 'inventory_reservation_consumed_quantity_requires_issue_service';
  END IF;

  IF OLD.state <> 'ACTIVE'
     OR NEW.state NOT IN ('RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'inventory_reservation_invalid_state_transition';
  END IF;

  IF NEW.transitioned_at < OLD.transitioned_at THEN
    RAISE EXCEPTION 'inventory_reservation_transition_time_cannot_move_backwards';
  END IF;

  RETURN NEW;
END;
$$;

-- Delivery Order issue source and immutable line lineage.
CREATE TABLE IF NOT EXISTS sales.delivery_order_inventory_issues (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  delivery_order_id uuid NOT NULL,
  issue_source_type text NOT NULL CHECK (issue_source_type IN ('LOGISTICS_DISPATCH', 'PICKUP_HANDOVER')),
  issue_source_id text NOT NULL CHECK (char_length(btrim(issue_source_id)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'POSTING' CHECK (status IN ('POSTING', 'POSTED', 'REVERSED')),
  inventory_movement_id uuid NULL,
  inventory_reversal_movement_id uuid NULL,
  receiver_name text NULL CHECK (receiver_name IS NULL OR char_length(btrim(receiver_name)) BETWEEN 1 AND 256),
  receiver_note text NULL CHECK (receiver_note IS NULL OR char_length(btrim(receiver_note)) <= 2000),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  posted_at timestamptz NULL,
  posted_by text NULL CHECK (posted_by IS NULL OR char_length(posted_by) BETWEEN 1 AND 128),
  reversed_at timestamptz NULL,
  reversed_by text NULL CHECK (reversed_by IS NULL OR char_length(reversed_by) BETWEEN 1 AND 128),
  reversal_reason text NULL CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_order_inventory_issues_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_order_inventory_issues_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT delivery_order_inventory_issues_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issues_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issues_reversal_fk
    FOREIGN KEY (installation_id, inventory_reversal_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issues_posted_shape CHECK (
    status <> 'POSTED' OR (inventory_movement_id IS NOT NULL AND posted_at IS NOT NULL AND posted_by IS NOT NULL)
  ),
  CONSTRAINT delivery_order_inventory_issues_reversed_shape CHECK (
    status <> 'REVERSED' OR (
      inventory_movement_id IS NOT NULL AND inventory_reversal_movement_id IS NOT NULL
      AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_reason IS NOT NULL
    )
  ),
  CONSTRAINT delivery_order_inventory_issues_pickup_shape CHECK (
    issue_source_type <> 'PICKUP_HANDOVER' OR receiver_name IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_order_inventory_issues_one_active_idx
  ON sales.delivery_order_inventory_issues (installation_id, delivery_order_id)
  WHERE status IN ('POSTING', 'POSTED');
CREATE INDEX IF NOT EXISTS delivery_order_inventory_issues_queue_idx
  ON sales.delivery_order_inventory_issues (installation_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS sales.delivery_order_inventory_issue_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  issue_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  delivery_order_line_id uuid NOT NULL,
  fulfillment_demand_id uuid NOT NULL,
  fulfillment_allocation_id uuid NOT NULL,
  inventory_reservation_id uuid NOT NULL,
  inventory_movement_line_id uuid NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  issued_base_quantity numeric(30,12) NOT NULL CHECK (issued_base_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_order_inventory_issue_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_order_inventory_issue_lines_issue_line_unique UNIQUE (installation_id, issue_id, delivery_order_line_id),
  CONSTRAINT delivery_order_inventory_issue_lines_issue_fk
    FOREIGN KEY (installation_id, issue_id)
    REFERENCES sales.delivery_order_inventory_issues (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issue_lines_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issue_lines_delivery_line_fk
    FOREIGN KEY (installation_id, delivery_order_line_id)
    REFERENCES sales.delivery_order_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issue_lines_demand_fk
    FOREIGN KEY (installation_id, fulfillment_demand_id)
    REFERENCES sales.sales_order_fulfillment_demands (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issue_lines_allocation_fk
    FOREIGN KEY (installation_id, fulfillment_allocation_id)
    REFERENCES sales.sales_order_fulfillment_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issue_lines_reservation_fk
    FOREIGN KEY (installation_id, inventory_reservation_id)
    REFERENCES inventory.inventory_reservations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_inventory_issue_lines_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS delivery_order_inventory_issue_lines_source_idx
  ON sales.delivery_order_inventory_issue_lines (
    installation_id, delivery_order_line_id, issue_id
  );
CREATE INDEX IF NOT EXISTS delivery_order_inventory_issue_lines_reservation_idx
  ON sales.delivery_order_inventory_issue_lines (
    installation_id, inventory_reservation_id, issue_id
  );

-- Customer Return foundation. Draft lines are immutable requests; receipt lines are
-- append-only accepted quantities created only when the warehouse receives the return.
CREATE TABLE IF NOT EXISTS sales.customer_returns (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  return_number text NULL CHECK (return_number IS NULL OR char_length(btrim(return_number)) BETWEEN 1 AND 160),
  return_number_allocation_id uuid NULL,
  customer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'received', 'cancelled')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  create_idempotency_key text NOT NULL CHECK (char_length(create_idempotency_key) BETWEEN 1 AND 128),
  create_payload_hash text NOT NULL CHECK (create_payload_hash ~ '^[0-9a-f]{64}$'),
  inventory_movement_id uuid NULL,
  received_at timestamptz NULL,
  received_by text NULL CHECK (received_by IS NULL OR char_length(received_by) BETWEEN 1 AND 128),
  cancelled_at timestamptz NULL,
  cancelled_by text NULL CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 128),
  cancellation_reason text NULL CHECK (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 1000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT customer_returns_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_returns_create_idempotency_unique UNIQUE (installation_id, create_idempotency_key),
  CONSTRAINT customer_returns_number_unique UNIQUE (installation_id, return_number),
  CONSTRAINT customer_returns_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_returns_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_returns_number_allocation_fk
    FOREIGN KEY (installation_id, return_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_returns_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_returns_received_shape CHECK (
    status <> 'received' OR (
      return_number IS NOT NULL AND return_number_allocation_id IS NOT NULL
      AND inventory_movement_id IS NOT NULL AND received_at IS NOT NULL AND received_by IS NOT NULL
    )
  ),
  CONSTRAINT customer_returns_cancelled_shape CHECK (
    status <> 'cancelled' OR (
      cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS customer_returns_queue_idx
  ON sales.customer_returns (installation_id, warehouse_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS sales.customer_return_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_return_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  delivery_order_id uuid NOT NULL,
  delivery_order_line_id uuid NOT NULL,
  issue_id uuid NOT NULL,
  issue_line_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  inventory_movement_line_id uuid NOT NULL,
  sales_order_id uuid NOT NULL,
  sales_order_line_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  requested_base_quantity numeric(30,12) NOT NULL CHECK (requested_base_quantity > 0),
  reason_code text NOT NULL CHECK (char_length(btrim(reason_code)) BETWEEN 1 AND 64),
  reason_note text NOT NULL CHECK (char_length(btrim(reason_note)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT customer_return_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_return_lines_number_unique UNIQUE (installation_id, customer_return_id, line_number),
  CONSTRAINT customer_return_lines_source_unique UNIQUE (installation_id, customer_return_id, issue_line_id),
  CONSTRAINT customer_return_lines_header_fk
    FOREIGN KEY (installation_id, customer_return_id)
    REFERENCES sales.customer_returns (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_delivery_line_fk
    FOREIGN KEY (installation_id, delivery_order_line_id)
    REFERENCES sales.delivery_order_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_issue_fk
    FOREIGN KEY (installation_id, issue_id)
    REFERENCES sales.delivery_order_inventory_issues (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_issue_line_fk
    FOREIGN KEY (installation_id, issue_line_id)
    REFERENCES sales.delivery_order_inventory_issue_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_lines_sales_line_fk
    FOREIGN KEY (installation_id, sales_order_line_id)
    REFERENCES sales.sales_order_version_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_return_lines_source_idx
  ON sales.customer_return_lines (installation_id, issue_line_id, customer_return_id);

CREATE TABLE IF NOT EXISTS sales.customer_return_receipt_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_return_id uuid NOT NULL,
  customer_return_line_id uuid NOT NULL,
  inventory_movement_line_id uuid NOT NULL,
  accepted_base_quantity numeric(30,12) NOT NULL CHECK (accepted_base_quantity > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT customer_return_receipt_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_return_receipt_lines_return_line_unique UNIQUE (installation_id, customer_return_line_id),
  CONSTRAINT customer_return_receipt_lines_header_fk
    FOREIGN KEY (installation_id, customer_return_id)
    REFERENCES sales.customer_returns (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_receipt_lines_line_fk
    FOREIGN KEY (installation_id, customer_return_line_id)
    REFERENCES sales.customer_return_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_receipt_lines_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sales.customer_return_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_return_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED', 'RECEIVED', 'CANCELLED')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_return_events_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_return_events_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT customer_return_events_header_fk
    FOREIGN KEY (installation_id, customer_return_id)
    REFERENCES sales.customer_returns (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Extend Delivery Order status and event vocabulary.
ALTER TABLE sales.delivery_orders DROP CONSTRAINT IF EXISTS delivery_orders_status_check;
ALTER TABLE sales.delivery_orders
  ADD CONSTRAINT delivery_orders_status_check
  CHECK (status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over', 'cancelled'));

ALTER TABLE sales.delivery_order_events DROP CONSTRAINT IF EXISTS delivery_order_events_event_type_check;
ALTER TABLE sales.delivery_order_events
  ADD CONSTRAINT delivery_order_events_event_type_check
  CHECK (event_type IN (
    'CREATED', 'CONFIRMED', 'CANCELLED',
    'INVENTORY_ISSUED', 'PICKUP_HANDED_OVER', 'INVENTORY_ISSUE_REVERSED'
  ));

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_header_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_order_write_context', true);
BEGIN
  IF write_context NOT IN ('delivery_order_service', 'delivery_issue_service') THEN
    RAISE EXCEPTION 'delivery_order_write_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery_order_delete_forbidden';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
       OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.customer_address_id IS DISTINCT FROM OLD.customer_address_id
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.handover_mode IS DISTINCT FROM OLD.handover_mode
       OR NEW.customer_code_snapshot IS DISTINCT FROM OLD.customer_code_snapshot
       OR NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot
       OR NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot
       OR NEW.warehouse_code_snapshot IS DISTINCT FROM OLD.warehouse_code_snapshot
       OR NEW.warehouse_name_snapshot IS DISTINCT FROM OLD.warehouse_name_snapshot
       OR NEW.requested_delivery_date IS DISTINCT FROM OLD.requested_delivery_date
       OR NEW.collection_policy IS DISTINCT FROM OLD.collection_policy
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
       OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'delivery_order_immutable_header_changed';
    END IF;

    IF write_context = 'delivery_order_service' THEN
      IF OLD.status = 'draft' AND NEW.status IN ('ready_to_dispatch', 'cancelled') THEN
        NULL;
      ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'delivery_order_invalid_status_transition';
      END IF;
    ELSE
      IF OLD.status = 'ready_to_dispatch' AND NEW.status IN ('dispatched', 'handed_over') THEN
        NULL;
      ELSIF OLD.status IN ('dispatched', 'handed_over') AND NEW.status = 'ready_to_dispatch' THEN
        NULL;
      ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'delivery_order_invalid_inventory_status_transition';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_demand_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_write_context', true);
BEGIN
  IF write_context NOT IN ('fulfillment_service', 'delivery_issue_service') THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_write_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales_fulfillment_demands_cannot_be_deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'sales_fulfillment_demand_must_start_active';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
     OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id
     OR NEW.line_number IS DISTINCT FROM OLD.line_number
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.sales_variant_id IS DISTINCT FROM OLD.sales_variant_id
     OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
     OR NEW.sku_snapshot IS DISTINCT FROM OLD.sku_snapshot
     OR NEW.ordered_base_quantity IS DISTINCT FROM OLD.ordered_base_quantity
     OR NEW.reserved_base_quantity IS DISTINCT FROM OLD.reserved_base_quantity
     OR NEW.backordered_base_quantity IS DISTINCT FROM OLD.backordered_base_quantity
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_immutable_fields_cannot_change';
  END IF;
  IF write_context = 'delivery_issue_service' THEN
    IF NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
       OR NEW.picked_base_quantity IS DISTINCT FROM OLD.picked_base_quantity
       OR NEW.packed_base_quantity IS DISTINCT FROM OLD.packed_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.issued_base_quantity < 0
       OR NEW.issued_base_quantity > NEW.packed_base_quantity THEN
      RAISE EXCEPTION 'sales_fulfillment_issue_projection_invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_terminal_state_is_immutable';
  END IF;
  IF NEW.allocated_base_quantity < OLD.allocated_base_quantity
     OR NEW.picked_base_quantity < OLD.picked_base_quantity
     OR NEW.packed_base_quantity < OLD.packed_base_quantity
     OR NEW.issued_base_quantity < OLD.issued_base_quantity
     OR NEW.cancelled_base_quantity < OLD.cancelled_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_progress_cannot_decrease';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sales.guard_delivery_issue_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_issue_write_context', true);
  source_line sales.delivery_order_lines;
  issue_record sales.delivery_order_inventory_issues;
  active_total numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_issue_service' THEN
    RAISE EXCEPTION 'delivery_issue_line_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_issue_lines_are_immutable';
  END IF;
  SELECT * INTO issue_record
    FROM sales.delivery_order_inventory_issues
   WHERE installation_id = NEW.installation_id AND id = NEW.issue_id
   FOR UPDATE;
  SELECT * INTO source_line
    FROM sales.delivery_order_lines
   WHERE installation_id = NEW.installation_id AND id = NEW.delivery_order_line_id;
  IF issue_record IS NULL OR source_line IS NULL
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

DROP TRIGGER IF EXISTS delivery_order_inventory_issue_lines_write_guard
  ON sales.delivery_order_inventory_issue_lines;
CREATE TRIGGER delivery_order_inventory_issue_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_order_inventory_issue_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_issue_line_write();

CREATE OR REPLACE FUNCTION sales.guard_customer_return_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.customer_return_write_context', true);
  source_issue sales.delivery_order_inventory_issues;
  source_issue_line sales.delivery_order_inventory_issue_lines;
  active_requested numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'customer_return_service' THEN
    RAISE EXCEPTION 'customer_return_line_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'customer_return_lines_are_immutable';
  END IF;
  SELECT * INTO source_issue
    FROM sales.delivery_order_inventory_issues
   WHERE installation_id = NEW.installation_id AND id = NEW.issue_id
   FOR UPDATE;
  SELECT * INTO source_issue_line
    FROM sales.delivery_order_inventory_issue_lines
   WHERE installation_id = NEW.installation_id AND id = NEW.issue_line_id;
  IF source_issue IS NULL OR source_issue.status <> 'POSTED'
     OR source_issue_line IS NULL OR source_issue_line.issue_id IS DISTINCT FROM NEW.issue_id
     OR source_issue_line.delivery_order_line_id IS DISTINCT FROM NEW.delivery_order_line_id
     OR source_issue_line.inventory_movement_line_id IS DISTINCT FROM NEW.inventory_movement_line_id
     OR source_issue.inventory_movement_id IS DISTINCT FROM NEW.inventory_movement_id THEN
    RAISE EXCEPTION 'customer_return_origin_mismatch';
  END IF;
  SELECT COALESCE(sum(line.requested_base_quantity), 0)
    INTO active_requested
    FROM sales.customer_return_lines line
    JOIN sales.customer_returns header
      ON header.installation_id = line.installation_id AND header.id = line.customer_return_id
   WHERE line.installation_id = NEW.installation_id
     AND line.issue_line_id = NEW.issue_line_id
     AND header.status IN ('draft', 'received');
  IF active_requested + NEW.requested_base_quantity > source_issue_line.issued_base_quantity THEN
    RAISE EXCEPTION 'customer_return_quantity_exceeds_issued';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_return_lines_write_guard ON sales.customer_return_lines;
CREATE TRIGGER customer_return_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.customer_return_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_line_write();

CREATE OR REPLACE FUNCTION sales.guard_customer_return_receipt_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.customer_return_write_context', true);
  source_line sales.customer_return_lines;
BEGIN
  IF write_context IS DISTINCT FROM 'customer_return_service' THEN
    RAISE EXCEPTION 'customer_return_receipt_line_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'customer_return_receipt_lines_are_append_only';
  END IF;
  SELECT * INTO source_line
    FROM sales.customer_return_lines
   WHERE installation_id = NEW.installation_id AND id = NEW.customer_return_line_id;
  IF source_line IS NULL
     OR source_line.customer_return_id IS DISTINCT FROM NEW.customer_return_id
     OR NEW.accepted_base_quantity > source_line.requested_base_quantity THEN
    RAISE EXCEPTION 'customer_return_receipt_quantity_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_return_receipt_lines_write_guard
  ON sales.customer_return_receipt_lines;
CREATE TRIGGER customer_return_receipt_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.customer_return_receipt_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_receipt_line_write();
