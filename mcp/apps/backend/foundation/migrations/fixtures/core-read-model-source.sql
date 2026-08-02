CREATE SCHEMA IF NOT EXISTS shared;

CREATE TABLE IF NOT EXISTS shared.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  group_id uuid,
  responsible_employee_id uuid,
  phone text,
  email text,
  tax_code text,
  payment_terms_days integer NOT NULL DEFAULT 0,
  credit_limit numeric NOT NULL DEFAULT 0,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'fixture',
  updated_by text NOT NULL DEFAULT 'fixture'
);

CREATE TABLE IF NOT EXISTS shared.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  catalog_name text,
  category_id uuid,
  brand_id uuid,
  description text,
  notes text,
  is_catalog_visible boolean NOT NULL DEFAULT true,
  is_orderable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'fixture',
  updated_by text NOT NULL DEFAULT 'fixture'
);

CREATE TABLE IF NOT EXISTS shared.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id text NOT NULL,
  product_id uuid NOT NULL REFERENCES shared.products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  variant_kind text NOT NULL DEFAULT 'default',
  is_inventory_base boolean NOT NULL DEFAULT false,
  is_sellable boolean NOT NULL DEFAULT true,
  is_catalog_visible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT 'fixture',
  updated_by text NOT NULL DEFAULT 'fixture',
  unit_id uuid,
  conversion_to_base numeric,
  is_purchasable boolean NOT NULL DEFAULT true,
  net_content_value numeric,
  net_content_uom_code text,
  source_unit_label text,
  source_package_description text,
  unit_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
