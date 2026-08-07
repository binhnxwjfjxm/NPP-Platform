-- Phase 7.5: moving weighted-average inventory costing foundation.
-- Cost facts are immutable snapshots derived from the append-only inventory ledger.
-- Cost balances are projector-owned and rebuildable; they never replace quantity truth.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.inventory-cost.read', 'Kho', 'Xem giá vốn tồn kho', 'Cho phép đọc số lượng, giá trị, giá bình quân và cost fact trong phạm vi kho được cấp.', true, now()),
  ('core.inventory-cost.rebuild', 'Kho', 'Dựng lại giá vốn tồn kho', 'Cho phép dựng lại moving-average cost facts và projection từ inventory ledger bất biến.', true, now()),
  ('core.inventory-cost.reconcile', 'Kho', 'Đối soát giá vốn tồn kho', 'Cho phép đọc đối soát quantity ledger với costing projection và anomaly nguồn giá.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_rebuild_runs (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  method_version text NOT NULL CHECK (method_version = 'MWA_V1'),
  currency_code text NOT NULL CHECK (currency_code = 'VND'),
  warehouse_ids uuid[] NOT NULL CHECK (cardinality(warehouse_ids) > 0),
  ledger_line_count integer NOT NULL CHECK (ledger_line_count >= 0),
  fact_count integer NOT NULL CHECK (fact_count >= 0),
  anomaly_count integer NOT NULL CHECK (anomaly_count >= 0),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_cost_rebuild_runs_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_cost_rebuild_runs_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_cost_rebuild_runs_time_check CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS inventory_cost_rebuild_runs_latest_idx
  ON inventory.inventory_cost_rebuild_runs (installation_id, completed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_facts (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL,
  rebuild_run_id uuid NOT NULL,
  method_version text NOT NULL CHECK (method_version = 'MWA_V1'),
  event_order bigint NOT NULL CHECK (event_order > 0),
  status text NOT NULL CHECK (status IN ('COSTED', 'ANOMALY')),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 96),
  inventory_movement_id uuid NOT NULL,
  inventory_movement_line_id uuid NOT NULL,
  reversal_of_cost_fact_id uuid NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  quantity_delta numeric(30,12) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost numeric(38,12) NULL,
  value_delta numeric(38,12) NULL,
  currency_code text NOT NULL CHECK (currency_code = 'VND'),
  source_cost_type text NOT NULL CHECK (char_length(source_cost_type) BETWEEN 1 AND 64),
  source_document_type text NULL,
  source_document_id text NULL,
  source_document_number text NULL,
  source_line_reference text NULL,
  effective_date date NOT NULL,
  movement_posted_at timestamptz NOT NULL,
  movement_line_number integer NOT NULL CHECK (movement_line_number > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_cost_facts_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_cost_facts_run_line_unique UNIQUE (installation_id, rebuild_run_id, inventory_movement_line_id),
  CONSTRAINT inventory_cost_facts_cost_shape CHECK (
    (status = 'COSTED' AND unit_cost IS NOT NULL AND value_delta IS NOT NULL)
    OR (status = 'ANOMALY' AND unit_cost IS NULL AND value_delta IS NULL)
  ),
  CONSTRAINT inventory_cost_facts_run_fk
    FOREIGN KEY (installation_id, rebuild_run_id)
    REFERENCES inventory.inventory_cost_rebuild_runs (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_facts_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_facts_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_facts_reversal_fk
    FOREIGN KEY (installation_id, reversal_of_cost_fact_id)
    REFERENCES inventory.inventory_cost_facts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_facts_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_facts_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_cost_facts_pool_idx
  ON inventory.inventory_cost_facts (
    installation_id, rebuild_run_id, warehouse_id, base_variant_id, event_order
  );
CREATE INDEX IF NOT EXISTS inventory_cost_facts_movement_idx
  ON inventory.inventory_cost_facts (
    installation_id, inventory_movement_id, movement_line_number
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_anomalies (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL,
  rebuild_run_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  inventory_movement_line_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,96}$'),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_cost_anomalies_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_cost_anomalies_run_line_unique UNIQUE (
    installation_id, rebuild_run_id, inventory_movement_line_id
  ),
  CONSTRAINT inventory_cost_anomalies_run_fk
    FOREIGN KEY (installation_id, rebuild_run_id)
    REFERENCES inventory.inventory_cost_rebuild_runs (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_anomalies_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_anomalies_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_cost_anomalies_lookup_idx
  ON inventory.inventory_cost_anomalies (
    installation_id, rebuild_run_id, warehouse_id, base_variant_id, code
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_balances (
  installation_id text NOT NULL,
  warehouse_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  method_version text NOT NULL CHECK (method_version = 'MWA_V1'),
  currency_code text NOT NULL CHECK (currency_code = 'VND'),
  quantity numeric(30,12) NOT NULL,
  inventory_value numeric(38,12) NULL,
  average_unit_cost numeric(38,12) NULL,
  status text NOT NULL CHECK (status IN ('COSTED', 'ANOMALY')),
  anomaly_count integer NOT NULL DEFAULT 0 CHECK (anomaly_count >= 0),
  projected_through_event bigint NOT NULL CHECK (projected_through_event >= 0),
  rebuild_run_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, warehouse_id, base_variant_id),
  CONSTRAINT inventory_cost_balances_value_shape CHECK (
    (status = 'COSTED' AND inventory_value IS NOT NULL AND average_unit_cost IS NOT NULL)
    OR (status = 'ANOMALY' AND inventory_value IS NULL AND average_unit_cost IS NULL)
  ),
  CONSTRAINT inventory_cost_balances_run_fk
    FOREIGN KEY (installation_id, rebuild_run_id)
    REFERENCES inventory.inventory_cost_rebuild_runs (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_balances_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_balances_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_cost_balances_run_idx
  ON inventory.inventory_cost_balances (installation_id, rebuild_run_id, warehouse_id);

CREATE OR REPLACE FUNCTION inventory.guard_inventory_cost_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_cost_facts_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_cost_runs_append_only ON inventory.inventory_cost_rebuild_runs;
CREATE TRIGGER inventory_cost_runs_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_cost_rebuild_runs
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_cost_append_only();

DROP TRIGGER IF EXISTS inventory_cost_facts_append_only ON inventory.inventory_cost_facts;
CREATE TRIGGER inventory_cost_facts_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_cost_facts
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_cost_append_only();

DROP TRIGGER IF EXISTS inventory_cost_anomalies_append_only ON inventory.inventory_cost_anomalies;
CREATE TRIGGER inventory_cost_anomalies_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_cost_anomalies
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_cost_append_only();

CREATE OR REPLACE FUNCTION inventory.guard_inventory_cost_balance_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('npp.inventory_cost_write_context', true) IS DISTINCT FROM 'projector' THEN
    RAISE EXCEPTION 'inventory_cost_balances_projector_only';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_cost_balances_projector_only ON inventory.inventory_cost_balances;
CREATE TRIGGER inventory_cost_balances_projector_only
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_cost_balances
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_cost_balance_write();

CREATE OR REPLACE VIEW inventory.inventory_cost_latest_runs AS
SELECT DISTINCT ON (installation_id)
       installation_id,
       id AS rebuild_run_id,
       method_version,
       currency_code,
       warehouse_ids,
       ledger_line_count,
       fact_count,
       anomaly_count,
       completed_at,
       created_by
  FROM inventory.inventory_cost_rebuild_runs
 ORDER BY installation_id, completed_at DESC, id DESC;

CREATE OR REPLACE VIEW inventory.inventory_cost_reconciliation AS
WITH latest AS (
  SELECT * FROM inventory.inventory_cost_latest_runs
),
ledger AS (
  SELECT movement.installation_id,
         line.warehouse_id,
         line.base_variant_id,
         round(sum(line.base_quantity_delta), 12) AS ledger_quantity
    FROM inventory.inventory_movements movement
    JOIN inventory.inventory_movement_lines line
      ON line.installation_id = movement.installation_id
     AND line.movement_id = movement.id
    JOIN latest
      ON latest.installation_id = movement.installation_id
     AND line.warehouse_id = ANY(latest.warehouse_ids)
   GROUP BY movement.installation_id, line.warehouse_id, line.base_variant_id
),
balance AS (
  SELECT stored.*
    FROM inventory.inventory_cost_balances stored
    JOIN latest
      ON latest.installation_id = stored.installation_id
     AND latest.rebuild_run_id = stored.rebuild_run_id
     AND stored.warehouse_id = ANY(latest.warehouse_ids)
),
scopes AS (
  SELECT installation_id, warehouse_id, base_variant_id FROM ledger
  UNION
  SELECT installation_id, warehouse_id, base_variant_id FROM balance
)
SELECT scope.installation_id,
       latest.rebuild_run_id,
       scope.warehouse_id,
       warehouse.code AS warehouse_code,
       warehouse.name AS warehouse_name,
       scope.base_variant_id,
       variant.sku AS base_sku,
       COALESCE(ledger.ledger_quantity, 0::numeric) AS ledger_quantity,
       COALESCE(balance.quantity, 0::numeric) AS costing_quantity,
       round(COALESCE(balance.quantity, 0::numeric) - COALESCE(ledger.ledger_quantity, 0::numeric), 12) AS quantity_difference,
       balance.inventory_value,
       balance.average_unit_cost,
       COALESCE(balance.status, 'ANOMALY') AS costing_status,
       COALESCE(balance.anomaly_count, 0) AS anomaly_count,
       CASE
         WHEN round(COALESCE(balance.quantity, 0::numeric) - COALESCE(ledger.ledger_quantity, 0::numeric), 12) <> 0 THEN 'QUANTITY_MISMATCH'
         WHEN balance.status IS DISTINCT FROM 'COSTED' THEN 'COST_ANOMALY'
         ELSE 'OK'
       END AS reconciliation_status
  FROM scopes scope
  JOIN latest
    ON latest.installation_id = scope.installation_id
  LEFT JOIN ledger
    ON ledger.installation_id = scope.installation_id
   AND ledger.warehouse_id = scope.warehouse_id
   AND ledger.base_variant_id = scope.base_variant_id
  LEFT JOIN balance
    ON balance.installation_id = scope.installation_id
   AND balance.warehouse_id = scope.warehouse_id
   AND balance.base_variant_id = scope.base_variant_id
  LEFT JOIN shared.warehouses warehouse
    ON warehouse.installation_id = scope.installation_id
   AND warehouse.id = scope.warehouse_id
  LEFT JOIN shared.product_variants variant
    ON variant.installation_id = scope.installation_id
   AND variant.id = scope.base_variant_id;
