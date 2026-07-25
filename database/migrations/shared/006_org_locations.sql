-- Phase 3 Slice 1: Organization and Warehouse — Warehouse Locations
-- Creates the shared.warehouse_locations table for storing warehouse location information
-- Location must reference an existing warehouse and have a unique code within that warehouse

CREATE TYPE shared.location_type_enum AS ENUM (
  'storage',
  'receiving',
  'shipping',
  'quarantine',
  'returns',
  'damaged',
  'other'
);

CREATE TABLE IF NOT EXISTS shared.warehouse_locations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  location_type shared.location_type_enum NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT warehouse_locations_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id) REFERENCES shared.warehouses (installation_id, id) ON DELETE RESTRICT,
  CONSTRAINT warehouse_locations_code_warehouse_unique
    UNIQUE (warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS warehouse_locations_installation_idx
  ON shared.warehouse_locations (installation_id);

CREATE INDEX IF NOT EXISTS warehouse_locations_warehouse_idx
  ON shared.warehouse_locations (warehouse_id);

CREATE INDEX IF NOT EXISTS warehouse_locations_installation_active_idx
  ON shared.warehouse_locations (installation_id, is_active);

CREATE INDEX IF NOT EXISTS warehouse_locations_updated_at_idx
  ON shared.warehouse_locations (updated_at DESC);
