-- Phase 6B: fail closed when master data becomes ineligible after a draft was saved.
-- This guard runs at confirmation time and does not post inventory, delivery, or accounting facts.

CREATE OR REPLACE FUNCTION sales.guard_sales_order_version_confirmation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_active boolean;
  warehouse_active boolean;
  address_valid boolean;
  invalid_line_count integer;
  line_count integer;
BEGIN
  IF NOT (OLD.version_status = 'draft' AND NEW.version_status = 'confirmed') THEN
    RETURN NEW;
  END IF;

  SELECT c.is_active
  INTO customer_active
  FROM shared.customers c
  WHERE c.installation_id = NEW.installation_id
    AND c.id = NEW.customer_id;

  IF customer_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'sales_order_customer_inactive';
  END IF;

  SELECT w.is_active
  INTO warehouse_active
  FROM shared.warehouses w
  WHERE w.installation_id = NEW.installation_id
    AND w.id = NEW.warehouse_id;

  IF warehouse_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'sales_order_warehouse_inactive';
  END IF;

  IF NEW.delivery_mode = 'DELIVERY' THEN
    SELECT EXISTS (
      SELECT 1
      FROM shared.customer_addresses ca
      WHERE ca.installation_id = NEW.installation_id
        AND ca.id = NEW.customer_address_id
        AND ca.customer_id = NEW.customer_id
        AND ca.is_active = true
    ) INTO address_valid;

    IF address_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'sales_order_address_inactive_or_mismatch';
    END IF;
  END IF;

  SELECT count(*)::integer
  INTO line_count
  FROM sales.sales_order_version_lines line
  WHERE line.installation_id = NEW.installation_id
    AND line.sales_order_version_id = NEW.id;

  IF line_count < 1 THEN
    RAISE EXCEPTION 'sales_order_empty';
  END IF;

  SELECT count(*)::integer
  INTO invalid_line_count
  FROM sales.sales_order_version_lines line
  JOIN shared.product_variants variant
    ON variant.installation_id = line.installation_id
   AND variant.id = line.variant_id
  JOIN shared.products product
    ON product.installation_id = variant.installation_id
   AND product.id = variant.product_id
  JOIN shared.units_of_measure unit
    ON unit.installation_id = line.installation_id
   AND unit.id = line.unit_id
  WHERE line.installation_id = NEW.installation_id
    AND line.sales_order_version_id = NEW.id
    AND (
      variant.is_active IS DISTINCT FROM true
      OR variant.is_sellable IS DISTINCT FROM true
      OR product.is_active IS DISTINCT FROM true
      OR product.is_orderable IS DISTINCT FROM true
      OR unit.is_active IS DISTINCT FROM true
      OR variant.unit_id IS DISTINCT FROM line.unit_id
      OR variant.conversion_to_base IS DISTINCT FROM line.conversion_to_base
    );

  IF invalid_line_count > 0 THEN
    RAISE EXCEPTION 'sales_order_line_ineligible';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_confirmation_guard
  ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_confirmation_guard
BEFORE UPDATE OF version_status ON sales.sales_order_versions
FOR EACH ROW
EXECUTE FUNCTION sales.guard_sales_order_version_confirmation();
