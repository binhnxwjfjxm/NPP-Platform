-- Phase 3.3D: Product units, product-specific conversions and barcodes.
-- Product variants remain the canonical sell/purchase-unit SKU identity.
-- Inventory is normalized to each product's active inventory-base variant.

CREATE TABLE IF NOT EXISTS shared.units_of_measure (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 32
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,32}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 128),
  symbol text NULL CHECK (symbol IS NULL OR char_length(btrim(symbol)) BETWEEN 1 AND 32),
  unit_kind text NOT NULL CHECK (unit_kind IN ('COUNT', 'WEIGHT', 'VOLUME', 'PACKAGE', 'OTHER')),
  allows_fractional boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT units_of_measure_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT units_of_measure_code_installation_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS units_of_measure_installation_active_code_idx
  ON shared.units_of_measure (installation_id, is_active, code);
CREATE INDEX IF NOT EXISTS units_of_measure_search_name_idx
  ON shared.units_of_measure (installation_id, lower(name));

ALTER TABLE shared.product_variants
  ADD COLUMN IF NOT EXISTS unit_id uuid NULL,
  ADD COLUMN IF NOT EXISTS conversion_to_base numeric(20,6) NULL,
  ADD COLUMN IF NOT EXISTS is_purchasable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS net_content_value numeric(20,6) NULL,
  ADD COLUMN IF NOT EXISTS net_content_uom_code text NULL,
  ADD COLUMN IF NOT EXISTS source_unit_label text NULL,
  ADD COLUMN IF NOT EXISTS source_package_description text NULL,
  ADD COLUMN IF NOT EXISTS unit_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_unit_installation_fk'
      AND conrelid = 'shared.product_variants'::regclass
  ) THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_unit_installation_fk
      FOREIGN KEY (installation_id, unit_id)
      REFERENCES shared.units_of_measure (installation_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_unit_conversion_pair_check'
      AND conrelid = 'shared.product_variants'::regclass
  ) THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_unit_conversion_pair_check
      CHECK ((unit_id IS NULL) = (conversion_to_base IS NULL));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_conversion_positive_check'
      AND conrelid = 'shared.product_variants'::regclass
  ) THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_conversion_positive_check
      CHECK (conversion_to_base IS NULL OR conversion_to_base > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_inventory_base_conversion_check'
      AND conrelid = 'shared.product_variants'::regclass
  ) THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_inventory_base_conversion_check
      CHECK (is_inventory_base = false OR conversion_to_base IS NULL OR conversion_to_base = 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_net_content_positive_check'
      AND conrelid = 'shared.product_variants'::regclass
  ) THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_net_content_positive_check
      CHECK (net_content_value IS NULL OR net_content_value > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_variants_net_content_uom_check'
      AND conrelid = 'shared.product_variants'::regclass
  ) THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_net_content_uom_check
      CHECK (net_content_uom_code IS NULL OR net_content_uom_code IN ('G', 'KG', 'ML', 'L', 'EA', 'OTHER'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS product_variants_one_active_unit_per_product_idx
  ON shared.product_variants (installation_id, product_id, unit_id)
  WHERE is_active = true AND unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_variants_unit_lookup_idx
  ON shared.product_variants (installation_id, unit_id, is_active);
CREATE INDEX IF NOT EXISTS product_variants_conversion_lookup_idx
  ON shared.product_variants (installation_id, product_id, conversion_to_base)
  WHERE is_active = true AND conversion_to_base IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared.product_barcodes (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  variant_id uuid NOT NULL,
  barcode text NOT NULL CHECK (char_length(btrim(barcode)) BETWEEN 1 AND 128),
  normalized_barcode text NOT NULL CHECK (
    char_length(normalized_barcode) BETWEEN 1 AND 128
    AND normalized_barcode = upper(btrim(normalized_barcode))
  ),
  barcode_type text NOT NULL DEFAULT 'OTHER'
    CHECK (barcode_type IN ('EAN13', 'EAN8', 'UPC_A', 'CODE128', 'INTERNAL', 'OTHER')),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  source_reference text NULL CHECK (source_reference IS NULL OR char_length(source_reference) <= 512),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT product_barcodes_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT product_barcodes_value_installation_unique UNIQUE (installation_id, normalized_barcode),
  CONSTRAINT product_barcodes_variant_installation_fk
    FOREIGN KEY (installation_id, variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS product_barcodes_variant_idx
  ON shared.product_barcodes (installation_id, variant_id, is_active, normalized_barcode);
CREATE UNIQUE INDEX IF NOT EXISTS product_barcodes_one_active_primary_idx
  ON shared.product_barcodes (installation_id, variant_id)
  WHERE is_active = true AND is_primary = true;
