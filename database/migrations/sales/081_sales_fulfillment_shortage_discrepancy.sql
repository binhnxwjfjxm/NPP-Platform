-- Issue #549 Lane C: canonical picking shortage, inventory discrepancy observation,
-- and explicit picking close facts. Reporting a discrepancy never adjusts inventory balances.

CREATE TABLE IF NOT EXISTS sales.sales_order_fulfillment_shortages (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  fulfillment_demand_id uuid NOT NULL,
  allocation_id uuid NOT NULL,
  sales_order_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  required_base_quantity numeric(30,12) NOT NULL CHECK (required_base_quantity > 0),
  picked_base_quantity numeric(30,12) NOT NULL CHECK (picked_base_quantity >= 0),
  remaining_base_quantity numeric(30,12) NOT NULL CHECK (remaining_base_quantity > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_fulfillment_shortages_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_order_fulfillment_shortages_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT sales_order_fulfillment_shortages_quantity_shape CHECK (
    picked_base_quantity + remaining_base_quantity = required_base_quantity
  ),
  CONSTRAINT sales_order_fulfillment_shortages_demand_fk
    FOREIGN KEY (installation_id, fulfillment_demand_id)
    REFERENCES sales.sales_order_fulfillment_demands (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_shortages_allocation_fk
    FOREIGN KEY (installation_id, allocation_id)
    REFERENCES sales.sales_order_fulfillment_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_shortages_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_shortages_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_shortages_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_shortages_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_shortages_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_order_fulfillment_shortages_order_idx
  ON sales.sales_order_fulfillment_shortages (
    installation_id, sales_order_id, fulfillment_demand_id, occurred_at DESC, id DESC
  );
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_shortages_allocation_idx
  ON sales.sales_order_fulfillment_shortages (
    installation_id, allocation_id, occurred_at DESC, id DESC
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_discrepancy_observations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  source_shortage_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  sku_snapshot text NULL,
  lot_id uuid NULL,
  lot_code_snapshot text NULL,
  book_base_quantity numeric(30,12) NOT NULL CHECK (book_base_quantity >= 0),
  observed_base_quantity numeric(30,12) NOT NULL CHECK (observed_base_quantity >= 0),
  delta_base_quantity numeric(30,12)
    GENERATED ALWAYS AS (observed_base_quantity - book_base_quantity) STORED,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_discrepancy_observations_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_discrepancy_observations_source_shortage_unique UNIQUE (installation_id, source_shortage_id),
  CONSTRAINT inventory_discrepancy_observations_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_discrepancy_observations_shortage_fk
    FOREIGN KEY (installation_id, source_shortage_id)
    REFERENCES sales.sales_order_fulfillment_shortages (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_discrepancy_observations_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_discrepancy_observations_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_discrepancy_observations_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_discrepancy_observations_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_discrepancy_observations_scope_idx
  ON inventory.inventory_discrepancy_observations (
    installation_id, warehouse_id, location_id, base_variant_id, lot_id, occurred_at DESC
  );

CREATE TABLE IF NOT EXISTS sales.sales_order_fulfillment_pick_closures (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  sales_order_id uuid NOT NULL,
  close_mode text NOT NULL CHECK (close_mode IN ('FULL', 'PARTIAL')),
  ordered_base_quantity numeric(30,12) NOT NULL CHECK (ordered_base_quantity >= 0),
  picked_base_quantity numeric(30,12) NOT NULL CHECK (picked_base_quantity >= 0),
  remaining_base_quantity numeric(30,12) NOT NULL CHECK (remaining_base_quantity >= 0),
  backordered_base_quantity numeric(30,12) NOT NULL CHECK (backordered_base_quantity >= 0),
  shortage_count integer NOT NULL CHECK (shortage_count >= 0),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_fulfillment_pick_closures_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_order_fulfillment_pick_closures_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT sales_order_fulfillment_pick_closures_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_order_fulfillment_pick_closures_order_idx
  ON sales.sales_order_fulfillment_pick_closures (
    installation_id, sales_order_id, occurred_at DESC, id DESC
  );

CREATE OR REPLACE FUNCTION sales.guard_fulfillment_shortage_fact_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.fulfillment_shortage_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'fulfillment_shortage_service' THEN
    RAISE EXCEPTION 'fulfillment_shortage_fact_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'fulfillment_shortage_facts_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_shortages_guard
  ON sales.sales_order_fulfillment_shortages;
CREATE TRIGGER sales_order_fulfillment_shortages_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_shortages
FOR EACH ROW EXECUTE FUNCTION sales.guard_fulfillment_shortage_fact_write();

DROP TRIGGER IF EXISTS inventory_discrepancy_observations_guard
  ON inventory.inventory_discrepancy_observations;
CREATE TRIGGER inventory_discrepancy_observations_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_discrepancy_observations
FOR EACH ROW EXECUTE FUNCTION sales.guard_fulfillment_shortage_fact_write();

DROP TRIGGER IF EXISTS sales_order_fulfillment_pick_closures_guard
  ON sales.sales_order_fulfillment_pick_closures;
CREATE TRIGGER sales_order_fulfillment_pick_closures_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_pick_closures
FOR EACH ROW EXECUTE FUNCTION sales.guard_fulfillment_shortage_fact_write();
