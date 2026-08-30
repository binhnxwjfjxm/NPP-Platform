-- Issue #764: freeze the business dimensions required by the Kinh doanh report.
-- Forward-only and rerun-safe. Confirmed historical versions are not rewritten.
-- Legacy rows remain explicitly distinguishable through *_snapshot_captured = false.

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS customer_group_id_snapshot uuid NULL,
  ADD COLUMN IF NOT EXISTS customer_group_code_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS customer_group_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS customer_group_snapshot_captured boolean NOT NULL DEFAULT false;

ALTER TABLE sales.sales_order_version_lines
  ADD COLUMN IF NOT EXISTS product_category_id_snapshot uuid NULL,
  ADD COLUMN IF NOT EXISTS product_category_code_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS product_category_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS unit_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS reporting_dimension_snapshot_captured boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_customer_group_snapshot_shape_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_customer_group_snapshot_shape_check CHECK (
        customer_group_snapshot_captured = false
        OR (
          (customer_group_id_snapshot IS NULL
            AND customer_group_code_snapshot IS NULL
            AND customer_group_name_snapshot IS NULL)
          OR
          (customer_group_id_snapshot IS NOT NULL
            AND customer_group_code_snapshot IS NOT NULL
            AND char_length(btrim(customer_group_code_snapshot)) BETWEEN 1 AND 64
            AND customer_group_name_snapshot IS NOT NULL
            AND char_length(btrim(customer_group_name_snapshot)) BETWEEN 1 AND 256)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_lines_reporting_snapshot_shape_check'
      AND conrelid = 'sales.sales_order_version_lines'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_lines_reporting_snapshot_shape_check CHECK (
        reporting_dimension_snapshot_captured = false
        OR (
          unit_name_snapshot IS NOT NULL
          AND char_length(btrim(unit_name_snapshot)) BETWEEN 1 AND 128
          AND (
            (product_category_id_snapshot IS NULL
              AND product_category_code_snapshot IS NULL
              AND product_category_name_snapshot IS NULL)
            OR
            (product_category_id_snapshot IS NOT NULL
              AND product_category_code_snapshot IS NOT NULL
              AND char_length(btrim(product_category_code_snapshot)) BETWEEN 1 AND 64
              AND product_category_name_snapshot IS NOT NULL
              AND char_length(btrim(product_category_name_snapshot)) BETWEEN 1 AND 256)
          )
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sales.capture_sales_order_reporting_version_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  group_id uuid;
  group_code text;
  group_name text;
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.version_status = 'draft'
     OR (TG_OP = 'UPDATE' AND OLD.version_status = 'draft' AND NEW.version_status = 'confirmed') THEN
    SELECT customer.group_id, customer_group.code, customer_group.name
      INTO group_id, group_code, group_name
      FROM shared.customers customer
      LEFT JOIN shared.customer_groups customer_group
        ON customer_group.installation_id = customer.installation_id
       AND customer_group.id = customer.group_id
     WHERE customer.installation_id = NEW.installation_id
       AND customer.id = NEW.customer_id;

    NEW.customer_group_id_snapshot := group_id;
    NEW.customer_group_code_snapshot := group_code;
    NEW.customer_group_name_snapshot := group_name;
    NEW.customer_group_snapshot_captured := true;

    IF TG_OP = 'UPDATE' AND OLD.version_status = 'draft' AND NEW.version_status = 'confirmed' THEN
      -- The parent is still draft while BEFORE UPDATE triggers execute, so refreshing
      -- child snapshots here respects the existing line immutability contract.
      UPDATE sales.sales_order_version_lines line
         SET reporting_dimension_snapshot_captured = false
       WHERE line.installation_id = NEW.installation_id
         AND line.sales_order_version_id = NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_reporting_snapshot_capture
  ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_reporting_snapshot_capture
BEFORE INSERT OR UPDATE OF customer_id, version_status, customer_group_snapshot_captured
ON sales.sales_order_versions
FOR EACH ROW EXECUTE FUNCTION sales.capture_sales_order_reporting_version_snapshot();

CREATE OR REPLACE FUNCTION sales.capture_sales_order_reporting_line_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  category_id uuid;
  category_code text;
  category_name text;
  unit_name text;
BEGIN
  SELECT product.category_id, category.code, category.name, unit.name
    INTO category_id, category_code, category_name, unit_name
    FROM shared.product_variants variant
    JOIN shared.products product
      ON product.installation_id = variant.installation_id
     AND product.id = variant.product_id
    JOIN shared.units_of_measure unit
      ON unit.installation_id = variant.installation_id
     AND unit.id = NEW.unit_id
    LEFT JOIN shared.product_categories category
      ON category.installation_id = product.installation_id
     AND category.id = product.category_id
   WHERE variant.installation_id = NEW.installation_id
     AND variant.id = NEW.variant_id;

  IF unit_name IS NULL THEN
    RAISE EXCEPTION 'sales_order_reporting_unit_snapshot_required';
  END IF;

  NEW.product_category_id_snapshot := category_id;
  NEW.product_category_code_snapshot := category_code;
  NEW.product_category_name_snapshot := category_name;
  NEW.unit_name_snapshot := unit_name;
  NEW.reporting_dimension_snapshot_captured := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_lines_reporting_snapshot_capture
  ON sales.sales_order_version_lines;
CREATE TRIGGER sales_order_lines_reporting_snapshot_capture
BEFORE INSERT OR UPDATE OF variant_id, unit_id, reporting_dimension_snapshot_captured
ON sales.sales_order_version_lines
FOR EACH ROW EXECUTE FUNCTION sales.capture_sales_order_reporting_line_snapshot();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_reporting_version_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.version_status <> 'draft'
     AND (
       NEW.customer_group_id_snapshot IS DISTINCT FROM OLD.customer_group_id_snapshot
       OR NEW.customer_group_code_snapshot IS DISTINCT FROM OLD.customer_group_code_snapshot
       OR NEW.customer_group_name_snapshot IS DISTINCT FROM OLD.customer_group_name_snapshot
       OR NEW.customer_group_snapshot_captured IS DISTINCT FROM OLD.customer_group_snapshot_captured
     ) THEN
    RAISE EXCEPTION 'sales_order_version_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_reporting_snapshot_immutable
  ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_reporting_snapshot_immutable
BEFORE UPDATE OF customer_group_id_snapshot, customer_group_code_snapshot,
  customer_group_name_snapshot, customer_group_snapshot_captured
ON sales.sales_order_versions
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_reporting_version_snapshot_mutation();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_reporting_line_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT version.version_status
    INTO parent_status
    FROM sales.sales_order_versions version
   WHERE version.installation_id = OLD.installation_id
     AND version.id = OLD.sales_order_version_id;

  IF parent_status <> 'draft'
     AND (
       NEW.product_category_id_snapshot IS DISTINCT FROM OLD.product_category_id_snapshot
       OR NEW.product_category_code_snapshot IS DISTINCT FROM OLD.product_category_code_snapshot
       OR NEW.product_category_name_snapshot IS DISTINCT FROM OLD.product_category_name_snapshot
       OR NEW.unit_name_snapshot IS DISTINCT FROM OLD.unit_name_snapshot
       OR NEW.reporting_dimension_snapshot_captured IS DISTINCT FROM OLD.reporting_dimension_snapshot_captured
     ) THEN
    RAISE EXCEPTION 'sales_order_version_line_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_lines_reporting_snapshot_immutable
  ON sales.sales_order_version_lines;
CREATE TRIGGER sales_order_lines_reporting_snapshot_immutable
BEFORE UPDATE OF product_category_id_snapshot, product_category_code_snapshot,
  product_category_name_snapshot, unit_name_snapshot, reporting_dimension_snapshot_captured
ON sales.sales_order_version_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_reporting_line_snapshot_mutation();

COMMENT ON COLUMN sales.sales_order_versions.customer_group_snapshot_captured IS
  'true when customer group was captured from the canonical customer master for this version; false identifies pre-migration legacy history';
COMMENT ON COLUMN sales.sales_order_version_lines.reporting_dimension_snapshot_captured IS
  'true when product category and unit name were captured for this order line; false identifies pre-migration legacy history';
