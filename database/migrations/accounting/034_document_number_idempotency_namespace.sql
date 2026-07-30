-- Phase 5.6 hardening: Core accepts idempotency keys up to 128 characters.
-- Internal document-number consumers namespace those keys, so the persisted derived
-- key must allow the namespace without truncation or collision.

ALTER TABLE shared.document_number_allocations
  DROP CONSTRAINT IF EXISTS document_number_allocations_idempotency_key_check;

ALTER TABLE shared.document_number_allocations
  ADD CONSTRAINT document_number_allocations_idempotency_key_check
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 160);
