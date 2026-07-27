-- Phase 3.3E: Data-driven price lists, channels, customer scopes and promotions.
-- Money is stored in currency minor units. Percent adjustments use basis points.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.price.read', 'Giá bán', 'Xem bảng giá', 'Cho phép đọc kênh bán, bảng giá, quy tắc giá và kết quả phân giải giá.', true, now()),
  ('core.price.write', 'Giá bán', 'Quản lý bảng giá', 'Cho phép tạo, cập nhật, nhập và thay đổi trạng thái bảng giá, quy tắc giá và chương trình.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.sales_channels (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 2000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_channels_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_channels_code_installation_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS sales_channels_installation_active_code_idx
  ON shared.sales_channels (installation_id, is_active, code);

CREATE TABLE IF NOT EXISTS shared.price_lists (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  list_type text NOT NULL CHECK (list_type IN ('BASE', 'CHANNEL', 'CUSTOMER_GROUP', 'CUSTOMER', 'PROMOTION', 'CUSTOM')),
  currency_code text NOT NULL DEFAULT 'VND' CHECK (currency_code ~ '^[A-Z]{3}$'),
  channel_id uuid NULL,
  customer_group_id uuid NULL,
  customer_id uuid NULL,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000000),
  stacking_mode text NOT NULL DEFAULT 'EXCLUSIVE' CHECK (stacking_mode IN ('EXCLUSIVE', 'STACKABLE')),
  stop_processing boolean NOT NULL DEFAULT false,
  effective_from timestamptz NULL,
  effective_to timestamptz NULL,
  description text NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT price_lists_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT price_lists_code_installation_unique UNIQUE (installation_id, code),
  CONSTRAINT price_lists_effective_range_check CHECK (
    effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT price_lists_channel_installation_fk
    FOREIGN KEY (installation_id, channel_id)
    REFERENCES shared.sales_channels (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT price_lists_customer_group_installation_fk
    FOREIGN KEY (installation_id, customer_group_id)
    REFERENCES shared.customer_groups (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT price_lists_customer_installation_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT price_lists_scope_type_check CHECK (
    (list_type = 'BASE' AND channel_id IS NULL AND customer_group_id IS NULL AND customer_id IS NULL)
    OR (list_type = 'CHANNEL' AND channel_id IS NOT NULL AND customer_group_id IS NULL AND customer_id IS NULL)
    OR (list_type = 'CUSTOMER_GROUP' AND customer_group_id IS NOT NULL AND customer_id IS NULL)
    OR (list_type = 'CUSTOMER' AND customer_id IS NOT NULL)
    OR list_type IN ('PROMOTION', 'CUSTOM')
  )
);

CREATE INDEX IF NOT EXISTS price_lists_resolution_idx
  ON shared.price_lists (installation_id, currency_code, is_active, priority DESC, list_type);
CREATE INDEX IF NOT EXISTS price_lists_channel_idx
  ON shared.price_lists (installation_id, channel_id, is_active) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS price_lists_customer_group_idx
  ON shared.price_lists (installation_id, customer_group_id, is_active) WHERE customer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS price_lists_customer_idx
  ON shared.price_lists (installation_id, customer_id, is_active) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared.price_list_items (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  price_list_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  adjustment_type text NOT NULL CHECK (adjustment_type IN (
    'FIXED_PRICE', 'PERCENT_DISCOUNT', 'AMOUNT_DISCOUNT', 'PERCENT_MARKUP', 'AMOUNT_MARKUP'
  )),
  amount_minor bigint NULL CHECK (amount_minor IS NULL OR amount_minor >= 0),
  rate_bps integer NULL CHECK (rate_bps IS NULL OR rate_bps BETWEEN 0 AND 1000000),
  min_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  max_quantity numeric(20,6) NULL CHECK (max_quantity IS NULL OR max_quantity > 0),
  effective_from timestamptz NULL,
  effective_to timestamptz NULL,
  source_kind text NOT NULL DEFAULT 'ADMIN' CHECK (source_kind IN ('ADMIN', 'IMPORT', 'CODE')),
  source_key text NULL CHECK (source_key IS NULL OR char_length(btrim(source_key)) BETWEEN 1 AND 256),
  external_rule_code text NULL CHECK (external_rule_code IS NULL OR char_length(btrim(external_rule_code)) BETWEEN 1 AND 128),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT price_list_items_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT price_list_items_list_installation_fk
    FOREIGN KEY (installation_id, price_list_id)
    REFERENCES shared.price_lists (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT price_list_items_variant_installation_fk
    FOREIGN KEY (installation_id, variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT price_list_items_value_check CHECK (
    (adjustment_type IN ('FIXED_PRICE', 'AMOUNT_DISCOUNT', 'AMOUNT_MARKUP') AND amount_minor IS NOT NULL AND rate_bps IS NULL)
    OR (adjustment_type IN ('PERCENT_DISCOUNT', 'PERCENT_MARKUP') AND amount_minor IS NULL AND rate_bps IS NOT NULL)
  ),
  CONSTRAINT price_list_items_quantity_range_check CHECK (
    max_quantity IS NULL OR max_quantity > min_quantity
  ),
  CONSTRAINT price_list_items_effective_range_check CHECK (
    effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS price_list_items_source_key_unique_idx
  ON shared.price_list_items (installation_id, source_key)
  WHERE source_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS price_list_items_resolution_idx
  ON shared.price_list_items (installation_id, variant_id, is_active, price_list_id, min_quantity, max_quantity);
CREATE INDEX IF NOT EXISTS price_list_items_list_idx
  ON shared.price_list_items (installation_id, price_list_id, is_active, variant_id);
