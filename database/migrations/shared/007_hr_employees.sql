-- Phase 3.2A: Employee directory
-- Stores canonical business employee records for the current installation.
-- Authentication identities and role assignments are intentionally deferred to later access slices.

CREATE TABLE IF NOT EXISTS shared.employees (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 256),
  job_title text NULL CHECK (job_title IS NULL OR char_length(job_title) <= 128),
  phone text NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
  email text NULL CHECK (email IS NULL OR char_length(email) <= 256),
  branch_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT employees_code_installation_unique
    UNIQUE (installation_id, code),
  CONSTRAINT employees_id_installation_unique
    UNIQUE (installation_id, id),
  CONSTRAINT employees_branch_installation_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS employees_installation_idx
  ON shared.employees (installation_id);

CREATE INDEX IF NOT EXISTS employees_installation_active_idx
  ON shared.employees (installation_id, is_active);

CREATE INDEX IF NOT EXISTS employees_installation_branch_idx
  ON shared.employees (installation_id, branch_id);

CREATE INDEX IF NOT EXISTS employees_updated_at_idx
  ON shared.employees (updated_at DESC);
