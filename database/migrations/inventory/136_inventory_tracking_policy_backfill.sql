-- Backfill the invariant required by inventory entry flows:
-- every SKU tồn chuẩn must have an explicit lot/expiry policy.
-- Existing canonical lot facts are preserved; this migration does not create,
-- delete or mutate inventory quantities, lots or movements.

WITH base_variants AS (
  SELECT variant.installation_id,
         variant.id AS base_variant_id,
         EXISTS (
           SELECT 1
             FROM inventory.inventory_lots lot
            WHERE lot.installation_id = variant.installation_id
              AND lot.base_variant_id = variant.id
         ) AS has_lot,
         EXISTS (
           SELECT 1
             FROM inventory.inventory_lots lot
            WHERE lot.installation_id = variant.installation_id
              AND lot.base_variant_id = variant.id
              AND lot.expiry_date IS NOT NULL
         ) AS has_expiry
    FROM shared.product_variants variant
   WHERE variant.is_inventory_base = true
)
INSERT INTO inventory.product_tracking_policies (
  installation_id,
  base_variant_id,
  lot_tracking_mode,
  expiry_tracking_mode,
  location_required,
  version,
  created_at,
  created_by,
  updated_at,
  updated_by
)
SELECT base.installation_id,
       base.base_variant_id,
       CASE WHEN base.has_lot THEN 'REQUIRED' ELSE 'NONE' END,
       CASE WHEN base.has_expiry THEN 'OPTIONAL' ELSE 'NONE' END,
       false,
       1,
       now(),
       'system:migration-136',
       now(),
       'system:migration-136'
  FROM base_variants base
 WHERE NOT EXISTS (
   SELECT 1
     FROM inventory.product_tracking_policies policy
    WHERE policy.installation_id = base.installation_id
      AND policy.base_variant_id = base.base_variant_id
 )
ON CONFLICT (installation_id, base_variant_id) DO NOTHING;
