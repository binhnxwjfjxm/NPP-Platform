-- Issue #942: warehouse-owned location management mode and governed conversion history.
-- This migration only adds configuration/history foundations. It never mutates inventory balances.

ALTER TABLE shared.warehouses
  ADD COLUMN IF NOT EXISTS location_management_mode text NULL,
  ADD COLUMN IF NOT EXISTS location_management_mode_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_management_configured_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS location_management_configured_by text NULL;

ALTER TABLE shared.warehouses
  DROP CONSTRAINT IF EXISTS warehouses_location_management_mode_ck;
ALTER TABLE shared.warehouses
  ADD CONSTRAINT warehouses_location_management_mode_ck CHECK (
    location_management_mode IS NULL
    OR location_management_mode IN ('MANAGED', 'UNMANAGED')
  );

ALTER TABLE shared.warehouses
  DROP CONSTRAINT IF EXISTS warehouses_location_management_mode_version_ck;
ALTER TABLE shared.warehouses
  ADD CONSTRAINT warehouses_location_management_mode_version_ck
  CHECK (location_management_mode_version >= 0);

ALTER TABLE shared.warehouses
  DROP CONSTRAINT IF EXISTS warehouses_location_management_configured_by_ck;
ALTER TABLE shared.warehouses
  ADD CONSTRAINT warehouses_location_management_configured_by_ck CHECK (
    location_management_configured_by IS NULL
    OR char_length(location_management_configured_by) BETWEEN 1 AND 128
  );

-- Deterministic backfill only when existing non-zero inventory points to exactly one model.
-- Empty warehouses and mixed legacy scopes remain NULL so rollout cannot guess their mode.
WITH warehouse_shape AS (
  SELECT warehouse.installation_id,
         warehouse.id AS warehouse_id,
         COALESCE(bool_or(
           (COALESCE(balance.on_hand_quantity, 0) <> 0 OR COALESCE(balance.reserved_quantity, 0) <> 0)
           AND balance.location_id IS NOT NULL
         ), false) AS has_located,
         COALESCE(bool_or(
           (COALESCE(balance.on_hand_quantity, 0) <> 0 OR COALESCE(balance.reserved_quantity, 0) <> 0)
           AND balance.location_id IS NULL
         ), false) AS has_unlocated
    FROM shared.warehouses warehouse
    LEFT JOIN inventory.inventory_balances balance
      ON balance.installation_id = warehouse.installation_id
     AND balance.warehouse_id = warehouse.id
   GROUP BY warehouse.installation_id, warehouse.id
), inferred AS (
  SELECT installation_id,
         warehouse_id,
         CASE
           WHEN has_located AND NOT has_unlocated THEN 'MANAGED'
           WHEN has_unlocated AND NOT has_located THEN 'UNMANAGED'
           ELSE NULL
         END AS inferred_mode
    FROM warehouse_shape
)
UPDATE shared.warehouses warehouse
   SET location_management_mode = inferred.inferred_mode,
       location_management_mode_version = CASE
         WHEN inferred.inferred_mode IS NULL THEN warehouse.location_management_mode_version
         ELSE GREATEST(warehouse.location_management_mode_version, 1)
       END,
       location_management_configured_at = CASE
         WHEN inferred.inferred_mode IS NULL THEN warehouse.location_management_configured_at
         ELSE COALESCE(warehouse.location_management_configured_at, now())
       END,
       location_management_configured_by = CASE
         WHEN inferred.inferred_mode IS NULL THEN warehouse.location_management_configured_by
         ELSE COALESCE(warehouse.location_management_configured_by, 'system:migration-131')
       END
  FROM inferred
 WHERE warehouse.installation_id = inferred.installation_id
   AND warehouse.id = inferred.warehouse_id
   AND warehouse.location_management_mode IS NULL
   AND inferred.inferred_mode IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.warehouse_location_mode_runs (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  warehouse_code_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64),
  warehouse_name_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 200),
  from_mode text NULL CHECK (from_mode IS NULL OR from_mode IN ('MANAGED', 'UNMANAGED')),
  target_mode text NOT NULL CHECK (target_mode IN ('MANAGED', 'UNMANAGED')),
  destination_location_id uuid NULL,
  destination_location_code_snapshot text NULL,
  destination_location_name_snapshot text NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._-]{1,128}$'
  ),
  issue_movement_id uuid NULL,
  receipt_movement_id uuid NULL,
  affected_sku_count integer NOT NULL CHECK (affected_sku_count >= 0),
  affected_scope_count integer NOT NULL CHECK (affected_scope_count >= 0),
  total_base_quantity numeric(30,12) NOT NULL CHECK (total_base_quantity >= 0),
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by text NOT NULL CHECK (char_length(completed_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT warehouse_location_mode_runs_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT warehouse_location_mode_runs_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT warehouse_location_mode_runs_destination_ck CHECK (
    (target_mode = 'MANAGED' AND destination_location_id IS NOT NULL)
    OR (target_mode = 'UNMANAGED' AND destination_location_id IS NULL)
  ),
  CONSTRAINT warehouse_location_mode_runs_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_runs_destination_location_fk
    FOREIGN KEY (installation_id, warehouse_id, destination_location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_runs_issue_movement_fk
    FOREIGN KEY (installation_id, issue_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_runs_receipt_movement_fk
    FOREIGN KEY (installation_id, receipt_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS warehouse_location_mode_runs_history_idx
  ON inventory.warehouse_location_mode_runs (
    installation_id, warehouse_id, completed_at DESC, id DESC
  );

CREATE TABLE IF NOT EXISTS inventory.warehouse_location_mode_run_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  run_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  warehouse_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  base_sku_snapshot text NOT NULL CHECK (char_length(base_sku_snapshot) BETWEEN 1 AND 96),
  lot_id uuid NULL,
  lot_code_snapshot text NULL,
  source_location_id uuid NULL,
  source_location_code_snapshot text NULL,
  source_location_name_snapshot text NULL,
  destination_location_id uuid NULL,
  destination_location_code_snapshot text NULL,
  destination_location_name_snapshot text NULL,
  base_quantity numeric(30,12) NOT NULL CHECK (base_quantity > 0),
  source_scope_version bigint NOT NULL CHECK (source_scope_version >= 0),
  destination_scope_version bigint NOT NULL CHECK (destination_scope_version >= 0),
  issue_movement_line_id uuid NULL,
  receipt_movement_line_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_location_mode_run_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT warehouse_location_mode_run_lines_number_unique UNIQUE (installation_id, run_id, line_number),
  CONSTRAINT warehouse_location_mode_run_lines_scope_unique UNIQUE NULLS NOT DISTINCT (
    installation_id, run_id, source_location_id, destination_location_id, base_variant_id, lot_id
  ),
  CONSTRAINT warehouse_location_mode_run_lines_distinct_location_ck CHECK (
    source_location_id IS DISTINCT FROM destination_location_id
  ),
  CONSTRAINT warehouse_location_mode_run_lines_run_fk
    FOREIGN KEY (installation_id, run_id)
    REFERENCES inventory.warehouse_location_mode_runs (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_source_location_fk
    FOREIGN KEY (installation_id, warehouse_id, source_location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_destination_location_fk
    FOREIGN KEY (installation_id, warehouse_id, destination_location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_issue_line_fk
    FOREIGN KEY (issue_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT warehouse_location_mode_run_lines_receipt_line_fk
    FOREIGN KEY (receipt_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS warehouse_location_mode_run_lines_history_idx
  ON inventory.warehouse_location_mode_run_lines (
    installation_id, run_id, line_number
  );

COMMENT ON COLUMN shared.warehouses.location_management_mode IS
  'Warehouse authority for location management. NULL is transitional/unconfigured and must not become a second runtime authority.';
COMMENT ON TABLE inventory.warehouse_location_mode_runs IS
  'Completed warehouse location-mode conversions. Stock changes are recorded only in immutable inventory movements.';
COMMENT ON TABLE inventory.warehouse_location_mode_run_lines IS
  'Detailed SKU/lot/location before-after log for one warehouse location-mode conversion.';
