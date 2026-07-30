ALTER TABLE purchasing.purchase_order_lines
  ADD COLUMN IF NOT EXISTS discount_mode text NULL,
  ADD COLUMN IF NOT EXISTS discount_value numeric(20,6) NULL,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(20,6) NULL;

UPDATE purchasing.purchase_order_lines
SET discount_mode = COALESCE(discount_mode, 'TOTAL_AMOUNT'),
    discount_value = COALESCE(discount_value, discount_amount, 0)
WHERE discount_mode IS NULL OR discount_value IS NULL;

ALTER TABLE purchasing.purchase_order_lines
  ALTER COLUMN discount_mode SET DEFAULT 'TOTAL_AMOUNT',
  ALTER COLUMN discount_mode SET NOT NULL,
  ALTER COLUMN discount_value SET DEFAULT 0,
  ALTER COLUMN discount_value SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_discount_mode_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_discount_mode_check
      CHECK (discount_mode IN ('TOTAL_AMOUNT', 'PER_UNIT', 'PERCENT'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_discount_value_nonnegative_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_discount_value_nonnegative_check
      CHECK (discount_value >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_discount_percent_range_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_discount_percent_range_check
      CHECK (discount_mode <> 'PERCENT' OR discount_value <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_tax_rate_range_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_tax_rate_range_check
      CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100));
  END IF;
END $$;
