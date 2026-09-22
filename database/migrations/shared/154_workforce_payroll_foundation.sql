-- Issue #1140 Lô 6: payroll foundation.
-- Additive only. Payroll reads a CLOSED attendance snapshot; it never mutates attendance source data.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.payroll.read', 'Tính lương', 'Xem dữ liệu tính lương', 'Cho phép xem kỳ lương, mức lương, khoản cố định và khoản phát sinh trong phạm vi được cấp.', true, now()),
  ('core.payroll.manage', 'Tính lương', 'Quản lý nền tính lương', 'Cho phép tạo kỳ lương và thiết lập dữ liệu nền tính lương trong phạm vi được cấp.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.payroll_periods (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  attendance_period_id uuid NOT NULL,
  attendance_revision integer NOT NULL CHECK (attendance_revision >= 1),
  attendance_source_fingerprint text NOT NULL CHECK (attendance_source_fingerprint ~ '^[0-9a-f]{64}$'),
  branch_id uuid NULL,
  scope_key text NOT NULL CHECK (
    (branch_id IS NULL AND scope_key = 'COMPANY')
    OR (branch_id IS NOT NULL AND scope_key = branch_id::text)
  ),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'AGGREGATING'
    CHECK (status IN ('AGGREGATING', 'NEEDS_ACTION', 'RECONCILED', 'CLOSED')),
  currency_code text NOT NULL DEFAULT 'VND' CHECK (currency_code ~ '^[A-Z]{3}$'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT payroll_periods_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_periods_attendance_unique UNIQUE (installation_id, attendance_period_id, attendance_revision),
  CONSTRAINT payroll_periods_scope_unique UNIQUE (installation_id, scope_key, period_start, period_end),
  CONSTRAINT payroll_periods_range_check CHECK (period_end >= period_start),
  CONSTRAINT payroll_periods_branch_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_periods_attendance_period_fk
    FOREIGN KEY (installation_id, attendance_period_id)
    REFERENCES shared.attendance_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_periods_attendance_snapshot_fk
    FOREIGN KEY (installation_id, attendance_period_id, attendance_revision)
    REFERENCES shared.attendance_period_snapshots (installation_id, period_id, revision)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payroll_periods_lookup_idx
  ON shared.payroll_periods (installation_id, period_start DESC, period_end DESC, branch_id, status);

CREATE TABLE IF NOT EXISTS shared.payroll_salary_profiles (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  monthly_salary numeric(18,2) NOT NULL CHECK (monthly_salary >= 0),
  currency_code text NOT NULL DEFAULT 'VND' CHECK (currency_code ~ '^[A-Z]{3}$'),
  effective_from date NOT NULL,
  effective_to date NULL,
  note text NULL CHECK (note IS NULL OR char_length(btrim(note)) <= 1000),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT payroll_salary_profiles_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_salary_profiles_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_salary_profiles_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT payroll_salary_profiles_start_unique UNIQUE (installation_id, employee_id, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_salary_profiles_one_open_idx
  ON shared.payroll_salary_profiles (installation_id, employee_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS payroll_salary_profiles_lookup_idx
  ON shared.payroll_salary_profiles (installation_id, employee_id, effective_from DESC, effective_to);

CREATE TABLE IF NOT EXISTS shared.payroll_component_types (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9._-]{2,32}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('INCOME', 'DEDUCTION', 'REIMBURSEMENT')),
  recurrence text NOT NULL CHECK (recurrence IN ('FIXED', 'PERIOD')),
  input_mode text NOT NULL CHECK (input_mode IN ('AUTOMATIC', 'MANUAL')),
  prorate_by_workdays boolean NOT NULL DEFAULT false,
  include_in_gross boolean NOT NULL DEFAULT false,
  include_in_net boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,
  effective_to date NULL,
  is_active boolean NOT NULL DEFAULT true,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT payroll_component_types_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_component_types_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT payroll_component_types_start_unique UNIQUE (installation_id, code, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_component_types_one_open_idx
  ON shared.payroll_component_types (installation_id, code)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS payroll_component_types_lookup_idx
  ON shared.payroll_component_types (installation_id, is_active, category, recurrence, effective_from DESC);

CREATE TABLE IF NOT EXISTS shared.payroll_employee_fixed_components (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  component_type_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  effective_from date NOT NULL,
  effective_to date NULL,
  note text NULL CHECK (note IS NULL OR char_length(btrim(note)) <= 1000),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT payroll_employee_fixed_components_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_employee_fixed_components_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_employee_fixed_components_type_fk
    FOREIGN KEY (installation_id, component_type_id)
    REFERENCES shared.payroll_component_types (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_employee_fixed_components_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT payroll_employee_fixed_components_start_unique UNIQUE (installation_id, employee_id, component_type_id, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_employee_fixed_components_one_open_idx
  ON shared.payroll_employee_fixed_components (installation_id, employee_id, component_type_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS payroll_employee_fixed_components_lookup_idx
  ON shared.payroll_employee_fixed_components (installation_id, employee_id, effective_from DESC, effective_to);

CREATE TABLE IF NOT EXISTS shared.payroll_period_components (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  component_type_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'APPROVED_REFERENCE', 'SYSTEM')),
  source_reference text NULL CHECK (source_reference IS NULL OR char_length(source_reference) <= 256),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT payroll_period_components_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_period_components_period_fk
    FOREIGN KEY (installation_id, payroll_period_id)
    REFERENCES shared.payroll_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_period_components_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_period_components_type_fk
    FOREIGN KEY (installation_id, component_type_id)
    REFERENCES shared.payroll_component_types (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payroll_period_components_lookup_idx
  ON shared.payroll_period_components (installation_id, payroll_period_id, employee_id, created_at);

CREATE OR REPLACE FUNCTION shared.reject_payroll_period_component_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payroll_period_components_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS payroll_period_components_append_only ON shared.payroll_period_components;
CREATE TRIGGER payroll_period_components_append_only
BEFORE UPDATE OR DELETE ON shared.payroll_period_components
FOR EACH ROW EXECUTE FUNCTION shared.reject_payroll_period_component_mutation();

COMMENT ON TABLE shared.payroll_periods IS
  'Payroll period foundation pinned to one immutable CLOSED attendance snapshot. Payroll never mutates attendance source data.';
COMMENT ON TABLE shared.payroll_salary_profiles IS
  'Effective-dated salary history. New salary rates close the prior range instead of overwriting historical amounts.';
COMMENT ON TABLE shared.payroll_component_types IS
  'Company-defined payroll component catalog: income, deduction or reimbursement; fixed or period-specific; automatic or manual.';
COMMENT ON TABLE shared.payroll_employee_fixed_components IS
  'Effective-dated fixed employee payroll components. Historical amounts remain queryable by business date.';
COMMENT ON TABLE shared.payroll_period_components IS
  'Append-only period-specific payroll components such as bonus, reimbursement or deduction. Corrections must use later adjustment lineage.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'shared' AND p.proname = 'grant_company_runtime_access')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;
