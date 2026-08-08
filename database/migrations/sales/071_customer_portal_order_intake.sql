-- Phase 9.2: external Customer Ordering identity -> canonical Core Sales Order boundary.
-- This migration creates portal identity/membership state only. Orders continue to live in sales.sales_orders.

CREATE TABLE IF NOT EXISTS shared.portal_users (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  display_name text NULL CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT portal_users_id_installation_unique UNIQUE (installation_id, id)
);

CREATE TABLE IF NOT EXISTS shared.portal_identities (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  portal_user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('CLERK')),
  provider_subject text NOT NULL CHECK (char_length(btrim(provider_subject)) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT portal_identities_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT portal_identities_provider_subject_unique UNIQUE (installation_id, provider, provider_subject),
  CONSTRAINT portal_identities_user_provider_unique UNIQUE (installation_id, portal_user_id, provider),
  CONSTRAINT portal_identities_user_installation_fk
    FOREIGN KEY (installation_id, portal_user_id)
    REFERENCES shared.portal_users (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sales.customer_portal_memberships (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  portal_user_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  default_warehouse_id uuid NOT NULL,
  sales_channel_id uuid NOT NULL,
  collection_policy text NOT NULL DEFAULT 'COLLECT_ON_DELIVERY' CHECK (collection_policy IN (
    'PREPAID', 'COLLECT_ON_DELIVERY', 'COLLECT_AFTER_DELIVERY', 'CREDIT_TERMS'
  )),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  allow_cancel boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT customer_portal_memberships_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_portal_memberships_user_customer_unique UNIQUE (installation_id, portal_user_id, customer_id),
  CONSTRAINT customer_portal_memberships_user_installation_fk
    FOREIGN KEY (installation_id, portal_user_id)
    REFERENCES shared.portal_users (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_portal_memberships_customer_installation_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_portal_memberships_warehouse_installation_fk
    FOREIGN KEY (installation_id, default_warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_portal_memberships_channel_installation_fk
    FOREIGN KEY (installation_id, sales_channel_id)
    REFERENCES shared.sales_channels (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS portal_identities_user_idx
  ON shared.portal_identities (installation_id, portal_user_id);
CREATE INDEX IF NOT EXISTS customer_portal_memberships_customer_idx
  ON sales.customer_portal_memberships (installation_id, customer_id, status);
CREATE INDEX IF NOT EXISTS customer_portal_memberships_user_idx
  ON sales.customer_portal_memberships (installation_id, portal_user_id, status);
