-- Issue #622 Lot 1: persist the Sales Order delivery execution method and keep
-- manual-delivery orders out of trip planning. This migration does not create
-- manual Inventory OUT, payment, receivable, or completion mutations.

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS delivery_execution_mode text NULL;

-- Existing confirmed/superseded versions are immutable to normal application writes.
-- Migration 089 is introducing a new historical fact, so backfill it under the
-- table owner's migration transaction without weakening the runtime guard afterwards.
ALTER TABLE sales.sales_order_versions
  DISABLE TRIGGER sales_order_versions_immutable;

UPDATE sales.sales_order_versions
SET delivery_execution_mode = CASE
  WHEN delivery_mode = 'DELIVERY' THEN 'TRIP'
  ELSE NULL
END
WHERE delivery_execution_mode IS NULL;

ALTER TABLE sales.sales_order_versions
  ENABLE TRIGGER sales_order_versions_immutable;

CREATE OR REPLACE FUNCTION sales.guard_sales_order_delivery_execution_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.version_status <> 'draft'
     AND NEW.delivery_execution_mode IS DISTINCT FROM OLD.delivery_execution_mode THEN
    RAISE EXCEPTION 'sales_order_version_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_delivery_execution_immutable
  ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_delivery_execution_immutable
BEFORE UPDATE OF delivery_execution_mode
ON sales.sales_order_versions
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_delivery_execution_mutation();

CREATE OR REPLACE FUNCTION sales.normalize_sales_order_delivery_execution_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Backward compatibility for writers that only know DELIVERY/PICKUP.
  IF NEW.delivery_mode = 'DELIVERY' AND NEW.delivery_execution_mode IS NULL THEN
    NEW.delivery_execution_mode := 'TRIP';
  ELSIF TG_OP = 'UPDATE'
        AND NEW.delivery_mode = 'PICKUP'
        AND OLD.delivery_mode IS DISTINCT FROM NEW.delivery_mode
        AND NEW.delivery_execution_mode IS NOT DISTINCT FROM OLD.delivery_execution_mode THEN
    NEW.delivery_execution_mode := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_delivery_execution_normalize
  ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_delivery_execution_normalize
BEFORE INSERT OR UPDATE OF delivery_mode, delivery_execution_mode
ON sales.sales_order_versions
FOR EACH ROW EXECUTE FUNCTION sales.normalize_sales_order_delivery_execution_mode();

ALTER TABLE sales.sales_order_versions
  DROP CONSTRAINT IF EXISTS sales_order_versions_delivery_execution_shape_check;
ALTER TABLE sales.sales_order_versions
  ADD CONSTRAINT sales_order_versions_delivery_execution_shape_check CHECK (
    (delivery_mode = 'DELIVERY' AND delivery_execution_mode IN ('TRIP', 'MANUAL'))
    OR (delivery_mode = 'PICKUP' AND delivery_execution_mode IS NULL)
  );

CREATE OR REPLACE FUNCTION logistics.guard_assignment_delivery_execution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  execution_mode text;
BEGIN
  -- Unassignment must remain possible even if an old row needs correction.
  IF TG_OP = 'INSERT' OR NEW.unassigned_at IS NULL THEN
    SELECT version.delivery_execution_mode
      INTO execution_mode
      FROM sales.delivery_orders delivery_order
      JOIN sales.sales_order_versions version
        ON version.installation_id = delivery_order.installation_id
       AND version.id = delivery_order.sales_order_version_id
     WHERE delivery_order.installation_id = NEW.installation_id
       AND delivery_order.id = NEW.delivery_order_id;

    IF execution_mode IS DISTINCT FROM 'TRIP' THEN
      RAISE EXCEPTION 'logistics_assignment_delivery_execution_denied';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_order_assignments_delivery_execution_guard
  ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_delivery_execution_guard
BEFORE INSERT OR UPDATE OF delivery_order_id, unassigned_at
ON logistics.trip_order_assignments
FOR EACH ROW EXECUTE FUNCTION logistics.guard_assignment_delivery_execution();
