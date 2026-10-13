-- Record physically received undelivered goods against exact manual Sales Order issue lines.
-- This is not a customer return after a completed sale.
CREATE TABLE sales.manual_delivery_return_receipts (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL,
  sales_order_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._-]{1,128}$'),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  posted_at timestamptz NOT NULL,
  posted_by text NOT NULL,
  request_id text NOT NULL,
  source_app text NOT NULL,
  UNIQUE (installation_id, id),
  UNIQUE (installation_id, idempotency_key),
  FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id) ON DELETE RESTRICT
);

CREATE INDEX manual_delivery_return_receipts_order_idx
  ON sales.manual_delivery_return_receipts (installation_id, sales_order_id, posted_at);

CREATE TABLE sales.manual_delivery_return_lines (
  id uuid PRIMARY KEY,
  installation_id text NOT NULL,
  receipt_id uuid NOT NULL,
  issue_movement_line_id uuid NOT NULL,
  sales_order_line_id uuid NOT NULL,
  returned_base_quantity numeric(30,12) NOT NULL CHECK (returned_base_quantity > 0),
  UNIQUE (installation_id, id),
  UNIQUE (installation_id, receipt_id, issue_movement_line_id),
  FOREIGN KEY (installation_id, receipt_id)
    REFERENCES sales.manual_delivery_return_receipts (installation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, issue_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (installation_id, sales_order_line_id)
    REFERENCES sales.sales_order_version_lines (installation_id, id) ON DELETE RESTRICT
);
CREATE INDEX manual_delivery_return_lines_origin_idx
  ON sales.manual_delivery_return_lines (installation_id, issue_movement_line_id);

CREATE OR REPLACE FUNCTION sales.guard_manual_delivery_return_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row record;
  receipt_row record;
  already_returned numeric(30,12);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'manual_delivery_return_immutable';
  END IF;
  IF current_setting('npp.manual_return_posting', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'manual_delivery_return_service_required';
  END IF;
  IF TG_TABLE_NAME = 'manual_delivery_return_lines' THEN
    SELECT sales_order_id, warehouse_id INTO receipt_row
      FROM sales.manual_delivery_return_receipts
     WHERE installation_id = NEW.installation_id AND id = NEW.receipt_id;
    SELECT movements.source_document_id AS sales_order_id,
           movements.reason_code,
           lines.metadata ->> 'salesOrderLineId' AS sales_order_line_id,
           lines.warehouse_id,
           -lines.base_quantity_delta AS issued_quantity
      INTO source_row
      FROM inventory.inventory_movement_lines lines
      JOIN inventory.inventory_movements movements
        ON movements.installation_id = lines.installation_id
       AND movements.id = lines.movement_id
     WHERE lines.installation_id = NEW.installation_id
       AND lines.id = NEW.issue_movement_line_id
       AND lines.direction = 'OUT'
     FOR UPDATE OF lines;
    IF receipt_row IS NULL OR source_row IS NULL
       OR source_row.reason_code IS DISTINCT FROM 'MANUAL_SALES_ORDER_STOCK_ISSUE'
       OR source_row.sales_order_id IS DISTINCT FROM receipt_row.sales_order_id
       OR source_row.sales_order_line_id IS DISTINCT FROM NEW.sales_order_line_id::text
       OR source_row.warehouse_id IS DISTINCT FROM receipt_row.warehouse_id THEN
      RAISE EXCEPTION 'manual_delivery_return_invalid_origin';
    END IF;
    SELECT coalesce(sum(returned_base_quantity), 0)
      INTO already_returned
      FROM sales.manual_delivery_return_lines
     WHERE installation_id = NEW.installation_id
       AND issue_movement_line_id = NEW.issue_movement_line_id;
    IF already_returned + NEW.returned_base_quantity > source_row.issued_quantity THEN
      RAISE EXCEPTION 'manual_delivery_return_exceeds_issued';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER manual_delivery_return_receipts_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.manual_delivery_return_receipts
FOR EACH ROW EXECUTE FUNCTION sales.guard_manual_delivery_return_receipt();
CREATE TRIGGER manual_delivery_return_lines_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.manual_delivery_return_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_manual_delivery_return_receipt();
