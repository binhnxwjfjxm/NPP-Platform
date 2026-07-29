-- Phase 5.3/5.4 follow-up: align goods receipt line base quantity validation with variance shape.

ALTER TABLE purchasing.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_conversion_check;

