-- Issue #633: canonical policy defining whether a product participates in Inventory.
-- Existing products stay inventory-managed so current production behavior is preserved.
-- This business policy is separate from product_variants.is_inventory_base, which only
-- identifies the technical base SKU used for inventory normalization.

ALTER TABLE shared.products
  ADD COLUMN IF NOT EXISTS is_inventory_managed boolean;

UPDATE shared.products
   SET is_inventory_managed = true
 WHERE is_inventory_managed IS NULL;

ALTER TABLE shared.products
  ALTER COLUMN is_inventory_managed SET DEFAULT true;

ALTER TABLE shared.products
  ALTER COLUMN is_inventory_managed SET NOT NULL;

COMMENT ON COLUMN shared.products.is_inventory_managed IS
  'Business policy: true when the product participates in Inventory; false when it does not create stock movements or balances.';
