CREATE SCHEMA IF NOT EXISTS shared;

-- Create suppliers table
CREATE TABLE IF NOT EXISTS shared.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id VARCHAR(128) NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  tax_id VARCHAR(50),
  bank_account VARCHAR(100),
  bank_name VARCHAR(255),
  avg_delivery_days INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(128),
  updated_by VARCHAR(128),
  CONSTRAINT suppliers_installation_code_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_installation_id ON shared.suppliers(installation_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_installation_active ON shared.suppliers(installation_id, is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_created_at ON shared.suppliers(created_at DESC);

-- Create supplier contacts table
CREATE TABLE IF NOT EXISTS shared.supplier_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES shared.suppliers(id) ON DELETE CASCADE,
  contact_name VARCHAR(255) NOT NULL,
  contact_title VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(100),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_contacts_unique_primary UNIQUE (supplier_id, is_primary) WHERE is_primary = TRUE
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier_id ON shared.supplier_contacts(supplier_id);

-- Create supplier addresses table
CREATE TABLE IF NOT EXISTS shared.supplier_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES shared.suppliers(id) ON DELETE CASCADE,
  address_type VARCHAR(50) NOT NULL DEFAULT 'billing',
  street_address VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  province VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100) DEFAULT 'Vietnam',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_addresses_unique_primary UNIQUE (supplier_id, address_type, is_primary) WHERE is_primary = TRUE
);

CREATE INDEX IF NOT EXISTS idx_supplier_addresses_supplier_id ON shared.supplier_addresses(supplier_id);

-- Create supplier payment terms table
CREATE TABLE IF NOT EXISTS shared.supplier_payment_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES shared.suppliers(id) ON DELETE CASCADE,
  payment_method VARCHAR(50) NOT NULL,
  term_days INTEGER,
  description VARCHAR(500),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT supplier_payment_terms_unique_primary UNIQUE (supplier_id, is_primary) WHERE is_primary = TRUE
);

CREATE INDEX IF NOT EXISTS idx_supplier_payment_terms_supplier_id ON shared.supplier_payment_terms(supplier_id);

-- Create supplier audit table for audit trail
CREATE TABLE IF NOT EXISTS shared.supplier_audit_log (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id VARCHAR(128) NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL DEFAULT 'supplier',
  resource_id UUID,
  actor_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_supplier_audit_log_resource_id ON shared.supplier_audit_log(resource_id);
CREATE INDEX IF NOT EXISTS idx_supplier_audit_log_created_at ON shared.supplier_audit_log(created_at DESC);
