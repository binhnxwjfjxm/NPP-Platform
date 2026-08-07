-- Phase 7.6: costing periods, immutable late cost events and reconciliation queue.
-- Owner lock: docs/operations/phase-7-5-costing-owner-decisions.md
-- CLOSED periods are immutable; current projection rebuilds only the mutable tail
-- seeded from the latest CLOSED snapshot.

CREATE TABLE IF NOT EXISTS inventory.inventory_costing_periods (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  closed_rebuild_run_id uuid NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by text NOT NULL CHECK (char_length(opened_by) BETWEEN 1 AND 128),
  closed_at timestamptz NULL,
  closed_by text NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_costing_periods_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_costing_periods_installation_period_unique UNIQUE (installation_id, period_start),
  CONSTRAINT inventory_costing_periods_month_boundary_check CHECK (
    period_start = date_trunc('month', period_start)::date
    AND period_end = (date_trunc('month', period_start) + interval '1 month' - interval '1 day')::date
  ),
  CONSTRAINT inventory_costing_periods_status_shape CHECK (
    (status = 'OPEN' AND closed_rebuild_run_id IS NULL AND closed_at IS NULL AND closed_by IS NULL)
    OR
    (status = 'CLOSED' AND closed_rebuild_run_id IS NOT NULL AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
  ),
  CONSTRAINT inventory_costing_periods_run_fk
    FOREIGN KEY (installation_id, closed_rebuild_run_id)
    REFERENCES inventory.inventory_cost_rebuild_runs (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_costing_periods_one_open_idx
  ON inventory.inventory_costing_periods (installation_id)
  WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS inventory_costing_periods_status_idx
  ON inventory.inventory_costing_periods (installation_id, status, period_start DESC);

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_period_balances (
  installation_id text NOT NULL,
  period_id uuid NOT NULL,
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
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, period_id, warehouse_id, base_variant_id),
  CONSTRAINT inventory_cost_period_balances_period_fk
    FOREIGN KEY (installation_id, period_id)
    REFERENCES inventory.inventory_costing_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_period_balances_run_fk
    FOREIGN KEY (installation_id, rebuild_run_id)
    REFERENCES inventory.inventory_cost_rebuild_runs (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_period_balances_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_period_balances_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_period_balances_value_shape CHECK (
    (status = 'COSTED' AND inventory_value IS NOT NULL AND average_unit_cost IS NOT NULL)
    OR (status = 'ANOMALY' AND inventory_value IS NULL AND average_unit_cost IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_adjustment_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  event_type text NOT NULL CHECK (event_type IN ('LANDED_COST', 'PURCHASE_PRICE_VARIANCE', 'FORWARD_CORRECTION')),
  effective_date date NOT NULL,
  posting_date date NOT NULL,
  warehouse_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  quantity_delta numeric(30,12) NOT NULL DEFAULT 0,
  value_delta numeric(38,12) NOT NULL,
  currency_code text NOT NULL CHECK (currency_code = 'VND'),
  allocation_group_id uuid NULL,
  allocation_basis text NULL CHECK (allocation_basis IN ('PURCHASE_VALUE', 'BASE_QUANTITY')),
  source_document_type text NOT NULL CHECK (char_length(source_document_type) BETWEEN 1 AND 96),
  source_document_id text NOT NULL CHECK (char_length(source_document_id) BETWEEN 1 AND 256),
  source_line_reference text NULL,
  original_cost_fact_id uuid NULL,
  original_movement_line_id uuid NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_cost_adjustment_events_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_cost_adjustment_events_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_cost_adjustment_events_nonzero_check CHECK (quantity_delta <> 0 OR value_delta <> 0),
  CONSTRAINT inventory_cost_adjustment_events_basis_check CHECK (
    (event_type = 'FORWARD_CORRECTION' AND allocation_basis IS NULL)
    OR (event_type IN ('LANDED_COST', 'PURCHASE_PRICE_VARIANCE') AND allocation_basis IS NOT NULL)
  ),
  CONSTRAINT inventory_cost_adjustment_events_forward_lineage_check CHECK (
    event_type <> 'FORWARD_CORRECTION'
    OR (original_cost_fact_id IS NOT NULL OR original_movement_line_id IS NOT NULL)
  ),
  CONSTRAINT inventory_cost_adjustment_events_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_adjustment_events_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_adjustment_events_original_fact_fk
    FOREIGN KEY (installation_id, original_cost_fact_id)
    REFERENCES inventory.inventory_cost_facts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_adjustment_events_original_line_fk
    FOREIGN KEY (installation_id, original_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_cost_adjustment_events_order_idx
  ON inventory.inventory_cost_adjustment_events (
    installation_id, posting_date, warehouse_id, base_variant_id, created_at, id
  );
CREATE INDEX IF NOT EXISTS inventory_cost_adjustment_events_source_idx
  ON inventory.inventory_cost_adjustment_events (
    installation_id, source_document_type, source_document_id
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_cost_discrepancies (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{1,96}$'),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  warehouse_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  inventory_movement_id uuid NULL,
  inventory_movement_line_id uuid NULL,
  cost_adjustment_event_id uuid NULL,
  period_id uuid NULL,
  stable_key text NOT NULL CHECK (char_length(stable_key) BETWEEN 1 AND 256),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  CONSTRAINT inventory_cost_discrepancies_stable_unique UNIQUE (installation_id, stable_key),
  CONSTRAINT inventory_cost_discrepancies_period_fk
    FOREIGN KEY (installation_id, period_id)
    REFERENCES inventory.inventory_costing_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_discrepancies_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_discrepancies_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_discrepancies_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_discrepancies_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_cost_discrepancies_adjustment_fk
    FOREIGN KEY (installation_id, cost_adjustment_event_id)
    REFERENCES inventory.inventory_cost_adjustment_events (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_cost_discrepancies_open_idx
  ON inventory.inventory_cost_discrepancies (installation_id, status, code, warehouse_id);

CREATE OR REPLACE FUNCTION inventory.guard_inventory_cost_phase76_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_cost_phase76_facts_are_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION inventory.guard_inventory_costing_period_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_costing_periods_are_not_deletable';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'closed_inventory_costing_period_is_immutable';
  END IF;
  IF NEW.installation_id <> OLD.installation_id
     OR NEW.id <> OLD.id
     OR NEW.period_start <> OLD.period_start
     OR NEW.period_end <> OLD.period_end
     OR NEW.opened_at <> OLD.opened_at
     OR NEW.opened_by <> OLD.opened_by
     OR NEW.request_id <> OLD.request_id
     OR NEW.source_app <> OLD.source_app THEN
    RAISE EXCEPTION 'inventory_costing_period_identity_is_immutable';
  END IF;
  IF NOT (OLD.status = 'OPEN' AND NEW.status = 'CLOSED') THEN
    RAISE EXCEPTION 'invalid_inventory_costing_period_transition';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_costing_periods_transition_guard ON inventory.inventory_costing_periods;
CREATE TRIGGER inventory_costing_periods_transition_guard
BEFORE UPDATE OR DELETE ON inventory.inventory_costing_periods
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_costing_period_transition();

DROP TRIGGER IF EXISTS inventory_cost_period_balances_append_only ON inventory.inventory_cost_period_balances;
CREATE TRIGGER inventory_cost_period_balances_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_cost_period_balances
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_cost_phase76_append_only();

DROP TRIGGER IF EXISTS inventory_cost_adjustment_events_append_only ON inventory.inventory_cost_adjustment_events;
CREATE TRIGGER inventory_cost_adjustment_events_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_cost_adjustment_events
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_cost_phase76_append_only();

CREATE OR REPLACE VIEW inventory.inventory_costing_period_status AS
SELECT period.id,
       period.installation_id,
       period.period_start,
       period.period_end,
       period.status,
       period.closed_rebuild_run_id,
       period.opened_at,
       period.opened_by,
       period.closed_at,
       period.closed_by,
       period.request_id,
       period.source_app,
       period.metadata,
       COALESCE(snapshot.pool_count, 0)::integer AS snapshot_pool_count,
       COALESCE(snapshot.anomaly_pool_count, 0)::integer AS snapshot_anomaly_pool_count
  FROM inventory.inventory_costing_periods period
  LEFT JOIN LATERAL (
    SELECT count(*) AS pool_count,
           count(*) FILTER (WHERE balance.status = 'ANOMALY') AS anomaly_pool_count
      FROM inventory.inventory_cost_period_balances balance
     WHERE balance.installation_id = period.installation_id
       AND balance.period_id = period.id
  ) snapshot ON true;
