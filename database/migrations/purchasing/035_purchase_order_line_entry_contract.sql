ALTER TABLE purchasing.purchase_order_lines
  ADD COLUMN IF NOT EXISTS discount_mode text NOT NULL DEFAULT 'TOTAL_AMOUNT',
  ADD COLUMN IF NOT EXISTS discount_value numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate numeric(20,6) NULL;

UPDATE purchasing.purchase_order_lines
SET discount_mode = 'TOTAL_AMOUNT',
    discount_value = COALESCE(discount_value, discount_amount, 0)
WHERE discount_mode IS NULL OR discount_value IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_lines_discount_mode_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_discount_mode_check
      CHECK (discount_mode IN ('TOTAL_AMOUNT','PERCENT'));
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
    WHERE conname = 'purchase_order_lines_tax_rate_nonnegative_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_tax_rate_nonnegative_check
      CHECK (tax_rate IS NULL OR tax_rate >= 0);
  END IF;
END $$;
