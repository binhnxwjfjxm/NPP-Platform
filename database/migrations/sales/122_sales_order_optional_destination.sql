-- Sales Order destinations are independent snapshots. A canonical customer address remains optional.
-- Trip delivery still requires a concrete destination snapshot; manual delivery may intentionally omit it.

CREATE OR REPLACE FUNCTION sales.guard_sales_order_version_confirmation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  customer_active boolean;
  warehouse_active boolean;
  address_valid boolean;
  destination_valid boolean;
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
    IF NEW.customer_address_id IS NOT NULL THEN
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

    destination_valid := NEW.customer_address_snapshot IS NOT NULL
      AND jsonb_typeof(NEW.customer_address_snapshot) = 'object'
      AND NULLIF(btrim(NEW.customer_address_snapshot ->> 'addressLine1'), '') IS NOT NULL;

    IF NEW.delivery_execution_mode = 'TRIP' AND destination_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'sales_order_delivery_destination_required';
    END IF;

    IF NEW.customer_address_id IS NULL
       AND NEW.customer_address_snapshot IS NOT NULL
       AND destination_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'sales_order_delivery_destination_invalid';
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

ALTER TABLE sales.delivery_orders
  DROP CONSTRAINT IF EXISTS delivery_orders_mode_shape;
ALTER TABLE sales.delivery_orders
  ADD CONSTRAINT delivery_orders_mode_shape CHECK (
    (
      handover_mode = 'DELIVERY'
      AND (
        customer_address_id IS NOT NULL
        OR NULLIF(btrim(destination_snapshot ->> 'addressLine1'), '') IS NOT NULL
      )
    )
    OR (
      handover_mode = 'PICKUP'
      AND customer_address_id IS NULL
    )
  );
