-- Phase 3.3A: Customer groups, customers and addresses
-- Canonical shared master data for one installation. No hard-delete path is provided.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.customer.read', 'Khách hàng', 'Xem khách hàng', 'Cho phép đọc nhóm khách hàng, khách hàng và địa chỉ khách hàng.', true, now()),
  ('core.customer.write', 'Khách hàng', 'Quản lý khách hàng', 'Cho phép tạo, cập nhật và thay đổi trạng thái nhóm khách hàng, khách hàng và địa chỉ.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.customer_groups (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 1000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT customer_groups_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_groups_code_installation_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS customer_groups_installation_active_idx
  ON shared.customer_groups (installation_id, is_active, code);

CREATE INDEX IF NOT EXISTS customer_groups_search_idx
  ON shared.customer_groups (installation_id, lower(name));

CREATE TABLE IF NOT EXISTS shared.customers (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  group_id uuid NULL,
  responsible_employee_id uuid NULL,
  phone text NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
  email text NULL CHECK (email IS NULL OR char_length(email) <= 256),
  tax_code text NULL CHECK (tax_code IS NULL OR char_length(tax_code) <= 64),
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 3650),
  credit_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  notes text NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT customers_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT customers_code_installation_unique UNIQUE (installation_id, code),
  CONSTRAINT customers_group_installation_fk
    FOREIGN KEY (installation_id, group_id)
    REFERENCES shared.customer_groups (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT customers_employee_installation_fk
    FOREIGN KEY (installation_id, responsible_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customers_installation_active_code_idx
  ON shared.customers (installation_id, is_active, code);

CREATE INDEX IF NOT EXISTS customers_installation_group_idx
  ON shared.customers (installation_id, group_id, is_active);

CREATE INDEX IF NOT EXISTS customers_installation_employee_idx
  ON shared.customers (installation_id, responsible_employee_id);

CREATE INDEX IF NOT EXISTS customers_search_name_idx
  ON shared.customers (installation_id, lower(name));

CREATE INDEX IF NOT EXISTS customers_updated_at_idx
  ON shared.customers (installation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS shared.customer_addresses (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  customer_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 128),
  recipient_name text NULL CHECK (recipient_name IS NULL OR char_length(recipient_name) <= 256),
  phone text NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
  address_line1 text NOT NULL CHECK (char_length(btrim(address_line1)) BETWEEN 1 AND 512),
  address_line2 text NULL CHECK (address_line2 IS NULL OR char_length(address_line2) <= 512),
  ward text NULL CHECK (ward IS NULL OR char_length(ward) <= 128),
  district text NULL CHECK (district IS NULL OR char_length(district) <= 128),
  province text NULL CHECK (province IS NULL OR char_length(province) <= 128),
  postal_code text NULL CHECK (postal_code IS NULL OR char_length(postal_code) <= 32),
  country_code text NOT NULL DEFAULT 'VN' CHECK (country_code ~ '^[A-Z]{2}$'),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT customer_addresses_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_addresses_customer_installation_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx
  ON shared.customer_addresses (installation_id, customer_id, is_active, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_active_default_idx
  ON shared.customer_addresses (installation_id, customer_id)
  WHERE is_default = true AND is_active = true;
