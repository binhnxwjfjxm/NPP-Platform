-- Issue #1140 Lô 7: payroll aggregation and reconciliation.
-- Additive only. Calculation snapshots are downstream of the pinned attendance snapshot.

ALTER TABLE shared.payroll_periods
  ADD COLUMN IF NOT EXISTS calculation_revision integer NOT NULL DEFAULT 0 CHECK (calculation_revision >= 0),
  ADD COLUMN IF NOT EXISTS calculation_fingerprint text NULL CHECK (calculation_fingerprint IS NULL OR calculation_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS issue_summary jsonb NOT NULL DEFAULT '{"blockers":{},"warnings":{}}'::jsonb CHECK (jsonb_typeof(issue_summary) = 'object'),
  ADD COLUMN IF NOT EXISTS reconciled_fingerprint text NULL CHECK (reconciled_fingerprint IS NULL OR reconciled_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS reconciled_by_actor_id text NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_note text NULL CHECK (reconciliation_note IS NULL OR char_length(btrim(reconciliation_note)) <= 1000);

CREATE TABLE IF NOT EXISTS shared.payroll_calculation_snapshots (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  payroll_period_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  issue_summary jsonb NOT NULL CHECK (jsonb_typeof(issue_summary) = 'object'),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_calculation_snapshots_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT payroll_calculation_snapshots_revision_unique UNIQUE (installation_id, payroll_period_id, revision),
  CONSTRAINT payroll_calculation_snapshots_period_fk
    FOREIGN KEY (installation_id, payroll_period_id)
    REFERENCES shared.payroll_periods (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS payroll_calculation_snapshots_lookup_idx
  ON shared.payroll_calculation_snapshots (installation_id, payroll_period_id, revision DESC);

CREATE OR REPLACE FUNCTION shared.reject_payroll_calculation_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payroll_calculation_snapshots_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS payroll_calculation_snapshots_append_only ON shared.payroll_calculation_snapshots;
CREATE TRIGGER payroll_calculation_snapshots_append_only
BEFORE UPDATE OR DELETE ON shared.payroll_calculation_snapshots
FOR EACH ROW EXECUTE FUNCTION shared.reject_payroll_calculation_snapshot_mutation();

COMMENT ON TABLE shared.payroll_calculation_snapshots IS
  'Append-only payroll calculation revisions. Each revision is derived from one pinned attendance snapshot plus effective-dated payroll inputs.';
COMMENT ON COLUMN shared.payroll_periods.calculation_fingerprint IS
  'Fingerprint of the salary, fixed component, period component and pinned attendance inputs used by the current calculation revision.';
COMMENT ON COLUMN shared.payroll_periods.reconciled_fingerprint IS
  'Calculation fingerprint confirmed by payroll reconciliation. Later source changes clear this value and require a new aggregation.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'shared' AND p.proname = 'grant_company_runtime_access')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;
