-- Phase 3.3C: Product catalog foundation
-- Canonical categories, brands, products and sell-unit SKU variants.
-- Units, conversions, barcodes, prices and media are intentionally deferred.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.product.read', 'Sản phẩm', 'Xem danh mục sản phẩm', 'Cho phép đọc danh mục, thương hiệu, sản phẩm và SKU.', true, now()),
  ('core.product.write', 'Sản phẩm', 'Quản lý danh mục sản phẩm', 'Cho phép tạo, cập nhật, nhập và thay đổi trạng thái dữ liệu sản phẩm.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.product_categories (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  parent_category_id uuid NULL,
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000000),
  is_catalog_visible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT product_categories_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT product_categories_code_installation_unique UNIQUE (installation_id, code),
  CONSTRAINT product_categories_not_self_parent CHECK (parent_category_id IS NULL OR parent_category_id <> id),
  CONSTRAINT product_categories_parent_installation_fk
    FOREIGN KEY (installation_id, parent_category_id)
    REFERENCES shared.product_categories (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS product_categories_installation_active_sort_idx
  ON shared.product_categories (installation_id, is_active, sort_order, code);
CREATE INDEX IF NOT EXISTS product_categories_parent_idx
  ON shared.product_categories (installation_id, parent_category_id);
CREATE INDEX IF NOT EXISTS product_categories_search_name_idx
  ON shared.product_categories (installation_id, lower(name));

CREATE TABLE IF NOT EXISTS shared.product_brands (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  is_catalog_visible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT product_brands_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT product_brands_code_installation_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS product_brands_installation_active_code_idx
  ON shared.product_brands (installation_id, is_active, code);
CREATE INDEX IF NOT EXISTS product_brands_search_name_idx
  ON shared.product_brands (installation_id, lower(name));

CREATE TABLE IF NOT EXISTS shared.products (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  catalog_name text NULL CHECK (catalog_name IS NULL OR char_length(btrim(catalog_name)) BETWEEN 1 AND 256),
  category_id uuid NULL,
  brand_id uuid NULL,
  description text NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  notes text NULL CHECK (notes IS NULL OR char_length(notes) <= 4000),
  is_catalog_visible boolean NOT NULL DEFAULT false,
  is_orderable boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT products_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT products_code_installation_unique UNIQUE (installation_id, code),
  CONSTRAINT products_category_installation_fk
    FOREIGN KEY (installation_id, category_id)
    REFERENCES shared.product_categories (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT products_brand_installation_fk
    FOREIGN KEY (installation_id, brand_id)
    REFERENCES shared.product_brands (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS products_installation_active_code_idx
  ON shared.products (installation_id, is_active, code);
CREATE INDEX IF NOT EXISTS products_category_idx
  ON shared.products (installation_id, category_id, is_active);
CREATE INDEX IF NOT EXISTS products_brand_idx
  ON shared.products (installation_id, brand_id, is_active);
CREATE INDEX IF NOT EXISTS products_catalog_idx
  ON shared.products (installation_id, is_catalog_visible, is_orderable, is_active);
CREATE INDEX IF NOT EXISTS products_search_name_idx
  ON shared.products (installation_id, lower(name));
CREATE INDEX IF NOT EXISTS products_search_catalog_name_idx
  ON shared.products (installation_id, lower(catalog_name));

CREATE TABLE IF NOT EXISTS shared.product_variants (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  product_id uuid NOT NULL,
  sku text NOT NULL CHECK (
    char_length(sku) BETWEEN 1 AND 96
    AND sku = upper(btrim(sku))
    AND sku ~ '^[A-Z0-9._/-]{1,96}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  variant_kind text NOT NULL DEFAULT 'BASE' CHECK (variant_kind IN ('BASE', 'CARTON', 'OTHER')),
  is_inventory_base boolean NOT NULL DEFAULT false,
  is_sellable boolean NOT NULL DEFAULT true,
  is_catalog_visible boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT product_variants_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT product_variants_sku_installation_unique UNIQUE (installation_id, sku),
  CONSTRAINT product_variants_product_installation_fk
    FOREIGN KEY (installation_id, product_id)
    REFERENCES shared.products (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT product_variants_inventory_base_kind_check
    CHECK (is_inventory_base = false OR variant_kind = 'BASE'),
  CONSTRAINT product_variants_catalog_sellable_check
    CHECK (is_catalog_visible = false OR is_sellable = true)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx
  ON shared.product_variants (installation_id, product_id, is_active, sku);
CREATE INDEX IF NOT EXISTS product_variants_installation_active_sku_idx
  ON shared.product_variants (installation_id, is_active, sku);
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_one_active_inventory_base_idx
  ON shared.product_variants (installation_id, product_id)
  WHERE is_inventory_base = true AND is_active = true;
