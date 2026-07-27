-- Phase 3.3B: Suppliers, contacts, addresses and supplier payment terms
-- Canonical shared master data for one installation. No hard-delete path is provided.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.supplier.read', 'Nhà cung cấp', 'Xem nhà cung cấp', 'Cho phép đọc nhà cung cấp, liên hệ, địa chỉ và điều khoản thanh toán.', true, now()),
  ('core.supplier.write', 'Nhà cung cấp', 'Quản lý nhà cung cấp', 'Cho phép tạo, cập nhật và thay đổi trạng thái dữ liệu nhà cung cấp.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.suppliers (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (
    char_length(code) BETWEEN 1 AND 64
    AND code = upper(btrim(code))
    AND code ~ '^[A-Z0-9_-]{1,64}$'
  ),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  tax_id text NULL CHECK (tax_id IS NULL OR char_length(tax_id) <= 64),
  bank_account text NULL CHECK (bank_account IS NULL OR char_length(bank_account) <= 64),
  bank_name text NULL CHECK (bank_name IS NULL OR char_length(bank_name) <= 256),
  avg_delivery_days integer NULL CHECK (avg_delivery_days IS NULL OR avg_delivery_days BETWEEN 0 AND 3650),
  purchase_owner_employee_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT suppliers_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT suppliers_code_installation_unique UNIQUE (installation_id, code),
  CONSTRAINT suppliers_employee_installation_fk
    FOREIGN KEY (installation_id, purchase_owner_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS suppliers_installation_active_code_idx
  ON shared.suppliers (installation_id, is_active, code);
CREATE INDEX IF NOT EXISTS suppliers_search_name_idx
  ON shared.suppliers (installation_id, lower(name));
CREATE INDEX IF NOT EXISTS suppliers_installation_employee_idx
  ON shared.suppliers (installation_id, purchase_owner_employee_id);
CREATE INDEX IF NOT EXISTS suppliers_updated_at_idx
  ON shared.suppliers (installation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS shared.supplier_contacts (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_id uuid NOT NULL,
  contact_name text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 1 AND 256),
  contact_title text NULL CHECK (contact_title IS NULL OR char_length(contact_title) <= 128),
  phone text NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
  email text NULL CHECK (email IS NULL OR char_length(email) <= 256),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT supplier_contacts_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT supplier_contacts_supplier_installation_fk
    FOREIGN KEY (installation_id, supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS supplier_contacts_supplier_idx
  ON shared.supplier_contacts (installation_id, supplier_id, is_active, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_contacts_one_active_primary_idx
  ON shared.supplier_contacts (installation_id, supplier_id)
  WHERE is_primary = true AND is_active = true;

CREATE TABLE IF NOT EXISTS shared.supplier_addresses (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_id uuid NOT NULL,
  address_type text NOT NULL DEFAULT 'business' CHECK (char_length(btrim(address_type)) BETWEEN 1 AND 50),
  street text NOT NULL CHECK (char_length(btrim(street)) BETWEEN 1 AND 512),
  city text NULL CHECK (city IS NULL OR char_length(city) <= 128),
  province text NULL CHECK (province IS NULL OR char_length(province) <= 128),
  postal_code text NULL CHECK (postal_code IS NULL OR char_length(postal_code) <= 32),
  country text NOT NULL DEFAULT 'Việt Nam' CHECK (char_length(btrim(country)) BETWEEN 1 AND 128),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT supplier_addresses_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT supplier_addresses_supplier_installation_fk
    FOREIGN KEY (installation_id, supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS supplier_addresses_supplier_idx
  ON shared.supplier_addresses (installation_id, supplier_id, is_active, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_addresses_one_active_primary_idx
  ON shared.supplier_addresses (installation_id, supplier_id)
  WHERE is_primary = true AND is_active = true;

CREATE TABLE IF NOT EXISTS shared.supplier_payment_terms (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_id uuid NOT NULL,
  payment_method text NOT NULL CHECK (char_length(btrim(payment_method)) BETWEEN 1 AND 64),
  term_days integer NULL CHECK (term_days IS NULL OR term_days BETWEEN 0 AND 3650),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 1000),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT supplier_payment_terms_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT supplier_payment_terms_supplier_installation_fk
    FOREIGN KEY (installation_id, supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS supplier_payment_terms_supplier_idx
  ON shared.supplier_payment_terms (installation_id, supplier_id, is_active, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payment_terms_one_active_primary_idx
  ON shared.supplier_payment_terms (installation_id, supplier_id)
  WHERE is_primary = true AND is_active = true;
