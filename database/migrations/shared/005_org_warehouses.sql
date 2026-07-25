-- Phase 3 Slice 1: Organization and Warehouse — Warehouses
-- Creates the shared.warehouses table for storing warehouse information
-- Warehouse must reference an existing branch and have a unique code within the installation

CREATE TYPE shared.warehouse_type_enum AS ENUM (
  'main',
  'distribution',
  'vehicle',
  'quarantine',
  'returns',
  'transit',
  'other'
);

CREATE TABLE IF NOT EXISTS shared.warehouses (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  branch_id uuid NOT NULL,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  warehouse_type shared.warehouse_type_enum NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT warehouses_branch_fk
    FOREIGN KEY (installation_id, branch_id) REFERENCES shared.branches (installation_id, id) ON DELETE RESTRICT,
  CONSTRAINT warehouses_code_installation_unique
    UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS warehouses_installation_idx
  ON shared.warehouses (installation_id);

CREATE INDEX IF NOT EXISTS warehouses_branch_idx
  ON shared.warehouses (branch_id);

CREATE INDEX IF NOT EXISTS warehouses_installation_active_idx
  ON shared.warehouses (installation_id, is_active);

CREATE INDEX IF NOT EXISTS warehouses_updated_at_idx
  ON shared.warehouses (updated_at DESC);
