-- Phase 5.7: supplier-owned purchase pricing and Purchase Order price provenance.
-- Purchase prices are intentionally isolated from Sales Pricing. No data is copied
-- from shared price lists and no historical Purchase Order is recalculated.

CREATE SCHEMA IF NOT EXISTS purchasing;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.supplier-purchase-price.read', 'Mua hàng', 'Xem bảng giá mua', 'Cho phép đọc và phân giải giá mua theo nhà cung cấp, SKU, đơn vị, tiền tệ và hiệu lực.', true, now()),
  ('core.supplier-purchase-price.manage', 'Mua hàng', 'Quản lý bảng giá mua', 'Cho phép tạo, cập nhật và thay đổi trạng thái giá mua theo nhà cung cấp.', true, now()),
  ('core.purchase-order.price.read', 'Mua hàng', 'Xem giá đơn đặt hàng', 'Cho phép đọc đơn giá, chiết khấu, thuế và tổng tiền của đơn đặt hàng.', true, now()),
  ('core.purchase-order.price.override', 'Mua hàng', 'Nhập tay giá đơn đặt hàng', 'Cho phép thay giá mua đã phân giải bằng giá nhập tay có lý do trên từng đơn đặt hàng.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS purchasing.supplier_purchase_prices (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  currency_code text NOT NULL DEFAULT 'VND' CHECK (
    char_length(currency_code) = 3 AND currency_code = upper(currency_code)
  ),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price > 0),
  min_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  effective_from date NOT NULL,
  effective_to date NULL,
  supplier_sku text NULL CHECK (supplier_sku IS NULL OR char_length(btrim(supplier_sku)) BETWEEN 1 AND 128),
  source_reference text NULL CHECK (source_reference IS NULL OR char_length(btrim(source_reference)) BETWEEN 1 AND 256),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  is_active boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT supplier_purchase_prices_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT supplier_purchase_prices_supplier_installation_fk
    FOREIGN KEY (installation_id, supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT supplier_purchase_prices_variant_installation_fk
    FOREIGN KEY (installation_id, variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT supplier_purchase_prices_unit_installation_fk
    FOREIGN KEY (installation_id, unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT supplier_purchase_prices_effective_range_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT supplier_purchase_prices_business_key_unique UNIQUE (
    installation_id,
    supplier_id,
    variant_id,
    unit_id,
    currency_code,
    min_quantity,
    effective_from
  )
);

CREATE INDEX IF NOT EXISTS supplier_purchase_prices_lookup_idx
  ON purchasing.supplier_purchase_prices (
    installation_id,
    supplier_id,
    variant_id,
    unit_id,
    currency_code,
    is_active,
    effective_from DESC,
    min_quantity DESC
  );

CREATE INDEX IF NOT EXISTS supplier_purchase_prices_supplier_idx
  ON purchasing.supplier_purchase_prices (
    installation_id,
    supplier_id,
    is_active,
    updated_at DESC
  );

ALTER TABLE purchasing.purchase_order_lines
  ADD COLUMN IF NOT EXISTS purchase_price_id uuid NULL,
  ADD COLUMN IF NOT EXISTS purchase_price_source text NULL,
  ADD COLUMN IF NOT EXISTS purchase_price_resolved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS supplier_sku_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS purchase_price_override_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_order_lines_purchase_price_source_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_purchase_price_source_check
      CHECK (purchase_price_source IS NULL OR purchase_price_source IN ('SUPPLIER_PRICE', 'MANUAL_OVERRIDE'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_order_lines_purchase_price_installation_fk'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_purchase_price_installation_fk
      FOREIGN KEY (installation_id, purchase_price_id)
      REFERENCES purchasing.supplier_purchase_prices (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_order_lines_purchase_price_shape_check'
      AND conrelid = 'purchasing.purchase_order_lines'::regclass
  ) THEN
    ALTER TABLE purchasing.purchase_order_lines
      ADD CONSTRAINT purchase_order_lines_purchase_price_shape_check
      CHECK (
        purchase_price_source IS NULL
        OR (
          unit_price > 0
          AND purchase_price_resolved_at IS NOT NULL
          AND (
            (purchase_price_source = 'SUPPLIER_PRICE' AND purchase_price_id IS NOT NULL AND purchase_price_override_reason IS NULL)
            OR
            (purchase_price_source = 'MANUAL_OVERRIDE' AND purchase_price_id IS NULL AND char_length(btrim(purchase_price_override_reason)) BETWEEN 1 AND 1000)
          )
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS purchase_order_lines_purchase_price_idx
  ON purchasing.purchase_order_lines (installation_id, purchase_price_id)
  WHERE purchase_price_id IS NOT NULL;
