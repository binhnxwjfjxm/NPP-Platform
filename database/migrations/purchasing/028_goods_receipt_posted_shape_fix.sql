-- Phase 5.3 follow-up: allow posted/reversed receipts without inventory movement when no inventory is posted.

ALTER TABLE purchasing.goods_receipts
  DROP CONSTRAINT IF EXISTS goods_receipts_posted_shape_check,
  DROP CONSTRAINT IF EXISTS goods_receipts_reversed_shape_check;

ALTER TABLE purchasing.goods_receipts
  ADD CONSTRAINT goods_receipts_posted_shape_check CHECK (
    status <> 'posted'
    OR (
      document_number IS NOT NULL
      AND document_number_allocation_id IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  ADD CONSTRAINT goods_receipts_reversed_shape_check CHECK (
    status <> 'reversed'
    OR (
      document_number IS NOT NULL
      AND document_number_allocation_id IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND reversed_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL
      AND (
        (inventory_movement_id IS NULL AND inventory_reversal_movement_id IS NULL)
        OR (inventory_movement_id IS NOT NULL AND inventory_reversal_movement_id IS NOT NULL)
      )
    )
  );

