-- Phase 3 Slice 1: Organization and Warehouse — Branches
-- Creates the shared.branches table for storing branch information
-- Branch is scoped to an installation and has a unique code within that installation

CREATE TABLE IF NOT EXISTS shared.branches (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  address text NULL CHECK (address IS NULL OR char_length(address) <= 512),
  phone text NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
  email text NULL CHECK (email IS NULL OR char_length(email) <= 256),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT branches_code_installation_unique
    UNIQUE (installation_id, code),
  CONSTRAINT branches_id_installation_unique
    UNIQUE (installation_id, id)
);

CREATE INDEX IF NOT EXISTS branches_installation_idx
  ON shared.branches (installation_id);

CREATE INDEX IF NOT EXISTS branches_installation_active_idx
  ON shared.branches (installation_id, is_active);

CREATE INDEX IF NOT EXISTS branches_updated_at_idx
  ON shared.branches (updated_at DESC);
