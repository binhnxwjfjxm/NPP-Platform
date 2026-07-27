export type ProductCategory = {
  id: string;
  code: string;
  name: string;
  parent_category_id: string | null;
  description: string | null;
  sort_order: number;
  is_catalog_visible: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductBrand = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_catalog_visible: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Product = {
  id: string;
  code: string;
  name: string;
  catalog_name: string | null;
  category_id: string | null;
  brand_id: string | null;
  category_code: string | null;
  category_name: string | null;
  brand_code: string | null;
  brand_name: string | null;
  description: string | null;
  notes: string | null;
  is_catalog_visible: boolean;
  is_orderable: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductVariantKind = 'BASE' | 'CARTON' | 'OTHER';

export type ProductVariant = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  variant_kind: ProductVariantKind;
  is_inventory_base: boolean;
  is_sellable: boolean;
  is_catalog_visible: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductForm = {
  code: string;
  name: string;
  catalogName: string;
  categoryId: string;
  brandId: string;
  description: string;
  notes: string;
  isCatalogVisible: boolean;
  isOrderable: boolean;
  isActive: boolean;
};

export type CategoryForm = {
  code: string;
  name: string;
  parentCategoryId: string;
  description: string;
  sortOrder: string;
  isCatalogVisible: boolean;
  isActive: boolean;
};

export type BrandForm = {
  code: string;
  name: string;
  description: string;
  isCatalogVisible: boolean;
  isActive: boolean;
};

export type VariantForm = {
  sku: string;
  name: string;
  variantKind: ProductVariantKind;
  isInventoryBase: boolean;
  isSellable: boolean;
  isCatalogVisible: boolean;
  isActive: boolean;
};
