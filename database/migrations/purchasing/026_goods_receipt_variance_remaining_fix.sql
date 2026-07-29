-- Phase 5.3 follow-up: keep goods receipt remaining quantity projection based on accepted quantity.
-- Only the draft-line immutability trigger is suspended for the deterministic backfill.

ALTER TABLE purchasing.goods_receipt_lines DISABLE TRIGGER goods_receipt_lines_draft_only;

ALTER TABLE purchasing.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_variance_check;

UPDATE purchasing.goods_receipt_lines
SET remaining_quantity_after = GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0)
WHERE remaining_quantity_after IS DISTINCT FROM GREATEST((remaining_quantity_before - accepted_quantity) - shortage_closed_quantity, 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM purchasing.goods_receipt_lines
     WHERE (rejected_quantity > 0 OR shortage_closed_quantity > 0)
       AND (
         quality_reason_code IS NULL
         OR quality_note IS NULL
         OR char_length(btrim(quality_reason_code)) NOT BETWEEN 1 AND 64
         OR char_length(btrim(quality_note)) NOT BETWEEN 1 AND 2000
       )
  ) THEN
    RAISE EXCEPTION 'goods_receipt_variance_reason_remediation_required';
  END IF;
END;
$$;

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

ALTER TABLE purchasing.goods_receipt_lines ENABLE TRIGGER goods_receipt_lines_draft_only;
