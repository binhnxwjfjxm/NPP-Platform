-- Issue #1140 Lô 8: payroll closeout, adjustments and immutable payslips.
-- Additive only. Closed payroll history is read from snapshots and is never rebuilt from current setup.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.payroll.close', 'Tính lương', 'Chốt kỳ lương', 'Cho phép chốt kỳ lương đã đối soát khi số liệu hiện tại còn đúng với bản đã xác nhận.', true, now()),
  ('core.payroll.adjust', 'Tính lương', 'Điều chỉnh lương sau chốt', 'Cho phép ghi điều chỉnh có lý do trên kỳ lương đã chốt; không sửa ngược bảng công hoặc phiếu lương cũ.', true, now()),
  ('core.payroll.export', 'Tính lương', 'Xuất bảng lương và phiếu lương', 'Cho phép xuất Excel bảng lương và PDF phiếu lương từ hồ sơ kỳ đã chốt.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE shared.payroll_periods
  ADD COLUMN IF NOT EXISTS closed_calculation_revision integer NULL CHECK (closed_calculation_revision IS NULL OR closed_calculation_revision >= 1),
  ADD COLUMN IF NOT EXISTS closed_calculation_fingerprint text NULL CHECK (closed_calculation_fingerprint IS NULL OR closed_calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS closed_by_actor_id text NULL,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS shared.payroll_close_snapshots (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payroll_period_id uuid NOT NULL,
  calculation_revision integer NOT NULL CHECK (calculation_revision >= 1),
  calculation_fingerprint text NOT NULL CHECK (calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  issue_summary jsonb NOT NULL CHECK (jsonb_typeof(issue_summary) = 'object'),
  reconciled_by_actor_id text NULL,
  reconciled_at timestamptz NULL,
  reconciliation_note text NULL CHECK (reconciliation_note IS NULL OR char_length(btrim(reconciliation_note)) <= 1000),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_close_snapshots_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_close_snapshots_period_unique UNIQUE (installation_id, payroll_period_id),
  CONSTRAINT payroll_close_snapshots_period_fk
    FOREIGN KEY (installation_id, payroll_period_id)
    REFERENCES shared.payroll_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS shared.payroll_payslip_snapshots (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  close_snapshot_id uuid NOT NULL,
  previous_snapshot_id uuid NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('CLOSE', 'ADJUSTMENT')),
  source_adjustment_id uuid NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_payslip_snapshots_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_payslip_snapshots_revision_unique UNIQUE (installation_id, payroll_period_id, employee_id, revision),
  CONSTRAINT payroll_payslip_snapshots_period_fk
    FOREIGN KEY (installation_id, payroll_period_id)
    REFERENCES shared.payroll_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_payslip_snapshots_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_payslip_snapshots_close_fk
    FOREIGN KEY (installation_id, close_snapshot_id)
    REFERENCES shared.payroll_close_snapshots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_payslip_snapshots_previous_fk
    FOREIGN KEY (installation_id, previous_snapshot_id)
    REFERENCES shared.payroll_payslip_snapshots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payroll_payslip_snapshots_lookup_idx
  ON shared.payroll_payslip_snapshots (installation_id, payroll_period_id, employee_id, revision DESC);

CREATE TABLE IF NOT EXISTS shared.payroll_adjustments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payroll_period_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  component_type_id uuid NOT NULL,
  component_code text NOT NULL CHECK (char_length(btrim(component_code)) BETWEEN 1 AND 32),
  component_name text NOT NULL CHECK (char_length(btrim(component_name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('INCOME', 'DEDUCTION', 'REIMBURSEMENT')),
  include_in_gross boolean NOT NULL,
  include_in_net boolean NOT NULL,
  direction text NOT NULL CHECK (direction IN ('ADD', 'REVERSE')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  previous_payslip_snapshot_id uuid NOT NULL,
  resulting_revision integer NOT NULL CHECK (resulting_revision >= 2),
  before_snapshot jsonb NOT NULL CHECK (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb NOT NULL CHECK (jsonb_typeof(after_snapshot) = 'object'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_adjustments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_adjustments_period_fk
    FOREIGN KEY (installation_id, payroll_period_id)
    REFERENCES shared.payroll_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_adjustments_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_adjustments_component_type_fk
    FOREIGN KEY (installation_id, component_type_id)
    REFERENCES shared.payroll_component_types (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payroll_adjustments_previous_payslip_fk
    FOREIGN KEY (installation_id, previous_payslip_snapshot_id)
    REFERENCES shared.payroll_payslip_snapshots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payroll_adjustments_lookup_idx
  ON shared.payroll_adjustments (installation_id, payroll_period_id, employee_id, created_at, id);

ALTER TABLE shared.payroll_payslip_snapshots
  DROP CONSTRAINT IF EXISTS payroll_payslip_snapshots_adjustment_fk;
ALTER TABLE shared.payroll_payslip_snapshots
  ADD CONSTRAINT payroll_payslip_snapshots_adjustment_fk
    FOREIGN KEY (installation_id, source_adjustment_id)
    REFERENCES shared.payroll_adjustments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION shared.reject_payroll_closeout_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payroll_closeout_history_is_append_only';
END;
$$;

DROP TRIGGER IF EXISTS payroll_close_snapshots_append_only ON shared.payroll_close_snapshots;
CREATE TRIGGER payroll_close_snapshots_append_only
BEFORE UPDATE OR DELETE ON shared.payroll_close_snapshots
FOR EACH ROW EXECUTE FUNCTION shared.reject_payroll_closeout_snapshot_mutation();

DROP TRIGGER IF EXISTS payroll_payslip_snapshots_append_only ON shared.payroll_payslip_snapshots;
CREATE TRIGGER payroll_payslip_snapshots_append_only
BEFORE UPDATE OR DELETE ON shared.payroll_payslip_snapshots
FOR EACH ROW EXECUTE FUNCTION shared.reject_payroll_closeout_snapshot_mutation();

DROP TRIGGER IF EXISTS payroll_adjustments_append_only ON shared.payroll_adjustments;
CREATE TRIGGER payroll_adjustments_append_only
BEFORE UPDATE OR DELETE ON shared.payroll_adjustments
FOR EACH ROW EXECUTE FUNCTION shared.reject_payroll_closeout_snapshot_mutation();

COMMENT ON TABLE shared.payroll_close_snapshots IS
  'Immutable close snapshot for one reconciled payroll period. History is never rebuilt from current employee or payroll setup.';
COMMENT ON TABLE shared.payroll_payslip_snapshots IS
  'Append-only employee payslip history. Revision 1 is created at close; later revisions come only from explicit payroll adjustments.';
COMMENT ON TABLE shared.payroll_adjustments IS
  'Append-only post-close payroll adjustments with reason, actor, time, before/after snapshots and payslip lineage.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'shared' AND p.proname = 'grant_company_runtime_access')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;
