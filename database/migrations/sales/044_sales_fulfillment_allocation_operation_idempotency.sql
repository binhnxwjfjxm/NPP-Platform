-- Phase 6D.2 operation-level idempotency for allocation commands.
-- One AUTO or MANUAL command may create multiple exact allocation rows; all rows
-- retain the same operation key while each exact reservation keeps a unique child key.

ALTER TABLE sales.sales_order_fulfillment_allocations
  ADD COLUMN IF NOT EXISTS operation_idempotency_key text;

UPDATE sales.sales_order_fulfillment_allocations
   SET operation_idempotency_key = idempotency_key
 WHERE operation_idempotency_key IS NULL;

ALTER TABLE sales.sales_order_fulfillment_allocations
  ALTER COLUMN operation_idempotency_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'sales_order_fulfillment_allocations_operation_key_check'
       AND conrelid = 'sales.sales_order_fulfillment_allocations'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_fulfillment_allocations
      ADD CONSTRAINT sales_order_fulfillment_allocations_operation_key_check
      CHECK (char_length(operation_idempotency_key) BETWEEN 1 AND 128);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_operation_key_idx
  ON sales.sales_order_fulfillment_allocations (
    installation_id, operation_idempotency_key, allocation_sequence
  );

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_operation_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.operation_idempotency_key IS DISTINCT FROM OLD.operation_idempotency_key THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_operation_key_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_operation_key_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_operation_key_guard
BEFORE UPDATE OF operation_idempotency_key
ON sales.sales_order_fulfillment_allocations
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_operation_key();
