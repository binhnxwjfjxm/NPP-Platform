-- A stocktake adjustment records the exact pre-count stock, including controlled
-- negative on-hand quantities allowed by the inventory ledger since migration 116.
-- Migration 143 incorrectly rejects negative system snapshot values with SQLSTATE 23514,
-- although bulk-preview correctly accepts them as signed on-hand balances.
-- The counted (physical) quantity remains non-negative under the separate check.

ALTER TABLE inventory.inventory_adjustment_lines
  DROP CONSTRAINT IF EXISTS inventory_adjustment_lines_system_quantity_snapshot_ck;

COMMENT ON COLUMN inventory.inventory_adjustment_lines.system_base_quantity_snapshot IS
  'Tồn hệ thống tại thời điểm đối chiếu, có thể âm theo sổ kho; lưu nguyên dấu để đối chiếu.';
