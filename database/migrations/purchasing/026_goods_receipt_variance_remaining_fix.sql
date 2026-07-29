-- Phase 5.3 follow-up: keep goods receipt remaining quantity projection based on accepted quantity.

ALTER TABLE purchasing.goods_receipt_lines DISABLE TRIGGER USER;

ALTER TABLE purchasing.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_variance_check;

UPDATE purchasing.goods_receipt_lines
SET remaining_quantity_after = GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0),
    quality_reason_code = CASE
      WHEN finalize_line = true AND quality_reason_code IS NULL THEN 'SHORTAGE_CLOSED'
      ELSE quality_reason_code
    END,
    quality_note = CASE
      WHEN finalize_line = true AND quality_note IS NULL THEN 'Shortage closed during migration alignment'
      ELSE quality_note
    END
WHERE remaining_quantity_after IS DISTINCT FROM GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0)
   OR (finalize_line = true AND (quality_reason_code IS NULL OR quality_note IS NULL));

ALTER TABLE purchasing.goods_receipt_lines
  ADD CONSTRAINT goods_receipt_lines_variance_check CHECK (
    received_quantity = accepted_quantity + rejected_quantity
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND shortage_closed_quantity >= 0
    AND (
      (shortage_closed_quantity = 0 AND finalize_line = false)
      OR (
        finalize_line = true
        AND shortage_closed_quantity = GREATEST(remaining_quantity_before - accepted_quantity, 0)
      )
    )
    AND (
      (rejected_quantity = 0 AND shortage_closed_quantity = 0)
      OR (
        quality_reason_code IS NOT NULL
        AND quality_note IS NOT NULL
        AND char_length(btrim(quality_reason_code)) BETWEEN 1 AND 64
        AND char_length(btrim(quality_note)) BETWEEN 1 AND 2000
      )
    )
    AND base_quantity = round(accepted_quantity * conversion_to_base, 6)
    AND remaining_quantity_after = GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0)
  );

ALTER TABLE purchasing.goods_receipt_lines ENABLE TRIGGER USER;
