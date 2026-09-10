-- Align the inventory-adjustment database invariant with the permission-aware approval contract.
--
-- The API already denies self-approval unless the actor is an Owner or has
-- core.inventory-adjustment.self-approve in addition to the normal approve permission.
-- Migration 061 predates that governed exception and still hard-blocks approved_by = created_by,
-- which turns an otherwise authorized Owner approval into a PostgreSQL check violation / HTTP 503.
--
-- Approval authorization remains enforced by the Công Ty API and is recorded through the
-- existing audit/outbox transaction. This migration only removes the obsolete unconditional
-- database prohibition; it does not grant any permission and it does not modify inventory data.

ALTER TABLE inventory.inventory_adjustments
  DROP CONSTRAINT IF EXISTS inventory_adjustments_creator_approver_separation_ck;
