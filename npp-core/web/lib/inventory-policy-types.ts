export type InventoryTrackingPolicyCandidate = {
  base_variant_id: string;
  base_sku: string;
  base_variant_name: string | null;
  base_variant_active: boolean;
  is_inventory_base: boolean;
  product_code: string;
  product_name: string;
  product_active: boolean;
  has_policy: boolean;
};
