-- Phase 6F.2 hardening: a reversed receivable document no longer contributes an
-- unapplied amount. Active documents retain the exact original-minus-allocated
-- projection; reversed documents retain their immutable original amount while
-- projecting both allocated and remaining amounts to zero.

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_amount_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_state_projection_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_reversal_reason_check;

ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_amount_check CHECK (
    allocated_amount >= 0
    AND allocated_amount <= original_amount
    AND (
      (
        status = 'reversed'
        AND allocated_amount = 0
        AND remaining_amount = 0
      )
      OR
      (
        status <> 'reversed'
        AND remaining_amount = original_amount - allocated_amount
      )
    )
  ),
  ADD CONSTRAINT receivable_documents_state_projection_check CHECK (
    (
      status = 'open'
      AND allocated_amount = 0
      AND remaining_amount = original_amount
    )
    OR (
      status = 'partially_allocated'
      AND allocated_amount > 0
      AND allocated_amount < original_amount
      AND remaining_amount > 0
    )
    OR (
      status = 'settled'
      AND allocated_amount = original_amount
      AND remaining_amount = 0
    )
    OR (
      status = 'reversed'
      AND allocated_amount = 0
      AND remaining_amount = 0
      AND reversed_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL
    )
  ),
  ADD CONSTRAINT receivable_documents_reversal_reason_check CHECK (
    reversal_reason IS NULL
    OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 2000
  );

-- UPDATE and DELETE are forbidden regardless of caller context. The service
-- context is only meaningful for appending a new immutable allocation fact.
CREATE OR REPLACE FUNCTION accounting.guard_receivable_allocation_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'receivable_allocation_history_is_append_only';
  END IF;
  IF write_context IS DISTINCT FROM 'receivable_service' THEN
    RAISE EXCEPTION 'receivable_history_write_requires_service_context';
  END IF;
  RETURN NEW;
END;
$$;
