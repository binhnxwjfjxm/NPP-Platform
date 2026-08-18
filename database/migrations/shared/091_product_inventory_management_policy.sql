-- Issue #633 prerequisite: explicit business policy for whether a product participates in Inventory.
-- Existing products remain inventory-managed to preserve current production behavior.
-- This flag is intentionally separate from product_variants.is_inventory_base, which remains
-- the technical base-SKU normalization contract for products that do participate in Inventory.

ALTER TABLE shared.products
  ADD COLUMN IF NOT EXISTS is_inventory_managed boolean NOT NULL DEFAULT true;

ALTER TABLE shared.products
  ALTER COLUMN is_inventory_managed SET DEFAULT true;

COMMENT ON COLUMN shared.products.is_inventory_managed IS
  'Business policy: true when product lines participate in warehouse reservation/pick/issue and Inventory Ledger; false when Sales remains commercial-only and Warehouse must skip the line.';
