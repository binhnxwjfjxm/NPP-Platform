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
  unit_id: string | null;
  conversion_to_base: string | null;
  is_purchasable: boolean;
  net_content_value: string | null;
  net_content_uom_code: string | null;
  source_unit_label: string | null;
  source_package_description: string | null;
  unit_code: string | null;
  unit_name: string | null;
  unit_symbol: string | null;
  unit_kind: UnitKind | null;
  allows_fractional: boolean | null;
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

export type UnitKind = 'COUNT' | 'WEIGHT' | 'VOLUME' | 'PACKAGE' | 'OTHER';

export type UnitOfMeasure = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  unit_kind: UnitKind;
  allows_fractional: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProductBarcode = {
  id: string;
  variant_id: string;
  barcode: string;
  normalized_barcode: string;
  barcode_type: 'EAN13' | 'EAN8' | 'UPC_A' | 'CODE128' | 'INTERNAL' | 'OTHER';
  is_primary: boolean;
  is_active: boolean;
  source_reference: string | null;
  created_at: string;
  updated_at: string;
};

export type UnitForm = {
  code: string;
  name: string;
  symbol: string;
  unitKind: UnitKind;
  allowsFractional: boolean;
  isActive: boolean;
};

export type VariantUnitForm = {
  unitId: string;
  conversionToBase: string;
  isPurchasable: boolean;
  netContentValue: string;
  netContentUnitCode: 'G' | 'KG' | 'ML' | 'L' | 'EA' | 'OTHER';
  sourceUnitLabel: string;
  sourcePackageDescription: string;
};

export type QuantityNormalization = {
  productId: string;
  variantId: string;
  sku: string;
  unitCode: string;
  enteredQuantity: string;
  conversionToBase: string;
  baseQuantity: string;
  inventoryBase: boolean;
};
