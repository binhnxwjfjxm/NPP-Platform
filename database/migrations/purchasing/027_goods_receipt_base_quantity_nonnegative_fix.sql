-- Phase 5.3 follow-up: allow rejected-only goods receipt lines to keep zero base quantity.

ALTER TABLE purchasing.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_base_quantity_check,
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_base_quantity_nonnegative_check;

ALTER TABLE purchasing.goods_receipt_lines
  ADD CONSTRAINT goods_receipt_lines_base_quantity_nonnegative_check CHECK (base_quantity >= 0);
