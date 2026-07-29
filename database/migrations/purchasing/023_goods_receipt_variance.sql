-- Phase 5.3: goods receipt quantity/quality variance.
-- Accepted quantity posts to inventory and consumes PO remaining.
-- Rejected quantity is variance-only and never consumes PO remaining or inventory.
-- Shortage closure can close the remaining PO quantity without inventory posting.
-- Reversal restores the accepted, rejected, shortage and PO status projections.
-- These invariants are verified by PostgreSQL/API and real-browser regression coverage.

CREATE SCHEMA IF NOT EXISTS purchasing;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.goods-receipt.variance', 'Mua hàng', 'Xử lý chênh lệch phiếu nhận', 'Cho phép nhập, ghi sổ và chốt chênh lệch chất lượng/số lượng trên phiếu nhận hàng.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE purchasing.goods_receipt_lines
  ADD COLUMN IF NOT EXISTS accepted_quantity numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_quantity numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shortage_closed_quantity numeric(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalize_line boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_reason_code text NULL,
  ADD COLUMN IF NOT EXISTS quality_note text NULL;

UPDATE purchasing.goods_receipt_lines
SET accepted_quantity = COALESCE(received_quantity, 0::numeric),
    rejected_quantity = 0::numeric,
    shortage_closed_quantity = 0::numeric,
    finalize_line = false,
    quality_reason_code = NULL,
    quality_note = NULL
WHERE accepted_quantity = 0::numeric
  AND rejected_quantity = 0::numeric
  AND shortage_closed_quantity = 0::numeric
  AND finalize_line = false
  AND quality_reason_code IS NULL
  AND quality_note IS NULL;

ALTER TABLE purchasing.goods_receipt_lines
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_conversion_check,
  DROP CONSTRAINT IF EXISTS goods_receipt_lines_base_quantity_check;

ALTER TABLE purchasing.goods_receipt_lines
  ADD CONSTRAINT goods_receipt_lines_base_quantity_nonnegative_check CHECK (base_quantity >= 0);

ALTER TABLE purchasing.goods_receipt_lines
  ADD CONSTRAINT goods_receipt_lines_variance_check CHECK (
    received_quantity = accepted_quantity + rejected_quantity
    AND accepted_quantity >= 0
    AND rejected_quantity >= 0
    AND shortage_closed_quantity >= 0
    AND accepted_quantity <= remaining_quantity_before
    AND (
      (finalize_line = false AND shortage_closed_quantity = 0)
      OR (
        finalize_line = true
        AND shortage_closed_quantity = remaining_quantity_before - accepted_quantity
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
    AND remaining_quantity_after = remaining_quantity_before - accepted_quantity - shortage_closed_quantity
  );

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

CREATE INDEX IF NOT EXISTS goods_receipt_lines_quality_reason_idx
  ON purchasing.goods_receipt_lines (installation_id, quality_reason_code)
  WHERE quality_reason_code IS NOT NULL;
