-- Issue #1140 Lô 2: canonical organization structure for Workforce.
-- Additive source migration only. No production execution is performed by this change.

CREATE TABLE IF NOT EXISTS shared.hr_departments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  parent_department_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT hr_departments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT hr_departments_code_unique UNIQUE (installation_id, code),
  CONSTRAINT hr_departments_parent_fk
    FOREIGN KEY (installation_id, parent_department_id)
    REFERENCES shared.hr_departments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT hr_departments_parent_not_self
    CHECK (parent_department_id IS NULL OR parent_department_id <> id)
);

CREATE INDEX IF NOT EXISTS hr_departments_parent_idx
  ON shared.hr_departments (installation_id, parent_department_id, is_active, code);

CREATE TABLE IF NOT EXISTS shared.hr_positions (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  department_id uuid NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT hr_positions_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT hr_positions_code_unique UNIQUE (installation_id, code),
  CONSTRAINT hr_positions_department_fk
    FOREIGN KEY (installation_id, department_id)
    REFERENCES shared.hr_departments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS hr_positions_department_idx
  ON shared.hr_positions (installation_id, department_id, is_active, code);

ALTER TABLE shared.employee_assignments
  ADD COLUMN IF NOT EXISTS department_id uuid NULL,
  ADD COLUMN IF NOT EXISTS position_id uuid NULL,
  ADD COLUMN IF NOT EXISTS manager_employee_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_assignments_department_fk'
      AND conrelid = 'shared.employee_assignments'::regclass
  ) THEN
    ALTER TABLE shared.employee_assignments
      ADD CONSTRAINT employee_assignments_department_fk
      FOREIGN KEY (installation_id, department_id)
      REFERENCES shared.hr_departments (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_assignments_position_fk'
      AND conrelid = 'shared.employee_assignments'::regclass
  ) THEN
    ALTER TABLE shared.employee_assignments
      ADD CONSTRAINT employee_assignments_position_fk
      FOREIGN KEY (installation_id, position_id)
      REFERENCES shared.hr_positions (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_assignments_manager_fk'
      AND conrelid = 'shared.employee_assignments'::regclass
  ) THEN
    ALTER TABLE shared.employee_assignments
      ADD CONSTRAINT employee_assignments_manager_fk
      FOREIGN KEY (installation_id, manager_employee_id)
      REFERENCES shared.employees (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employee_assignments_manager_not_self'
      AND conrelid = 'shared.employee_assignments'::regclass
  ) THEN
    ALTER TABLE shared.employee_assignments
      ADD CONSTRAINT employee_assignments_manager_not_self
      CHECK (manager_employee_id IS NULL OR manager_employee_id <> employee_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS employee_assignments_department_date_idx
  ON shared.employee_assignments (installation_id, department_id, effective_from, effective_to, employee_id);

CREATE INDEX IF NOT EXISTS employee_assignments_position_date_idx
  ON shared.employee_assignments (installation_id, position_id, effective_from, effective_to, employee_id);

CREATE INDEX IF NOT EXISTS employee_assignments_manager_date_idx
  ON shared.employee_assignments (installation_id, manager_employee_id, effective_from, effective_to, employee_id);

COMMENT ON TABLE shared.hr_departments IS
  'Canonical Công Ty department/team structure. Historical employee membership remains in employee_assignments.';
COMMENT ON TABLE shared.hr_positions IS
  'Canonical Công Ty job positions. shared.employees.job_title remains compatibility text only.';
COMMENT ON COLUMN shared.employee_assignments.manager_employee_id IS
  'Effective-dated direct manager for the assignment period. This is not inferred from role names or job-title text.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'shared' AND p.proname = 'grant_company_runtime_access'
  )
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;
