-- Issue #1140 Lô 4: leave balance ledger and dated balance contract.
-- Additive only. Existing leave types keep balance tracking OFF until Công Ty enables it.

ALTER TABLE shared.leave_types
  ADD COLUMN IF NOT EXISTS tracks_balance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_negative_balance boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leave_types_negative_balance_check'
      AND conrelid = 'shared.leave_types'::regclass
  ) THEN
    ALTER TABLE shared.leave_types
      ADD CONSTRAINT leave_types_negative_balance_check
      CHECK (NOT allow_negative_balance OR tracks_balance);
  END IF;
END
$$;

ALTER TABLE shared.leave_requests
  ADD COLUMN IF NOT EXISTS leave_tracks_balance_snapshot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leave_allow_negative_balance_snapshot boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS shared.leave_balance_ledger (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  leave_type_code_snapshot text NOT NULL CHECK (char_length(leave_type_code_snapshot) BETWEEN 1 AND 32),
  leave_type_name_snapshot text NOT NULL CHECK (char_length(btrim(leave_type_name_snapshot)) BETWEEN 1 AND 100),
  entry_type text NOT NULL CHECK (
    entry_type IN ('OPENING_GRANT', 'ACCRUAL', 'USAGE', 'ADJUSTMENT', 'CARRY_OVER', 'EXPIRY', 'COMPENSATORY', 'REVERSAL')
  ),
  quantity_days numeric(9,2) NOT NULL CHECK (quantity_days <> 0 AND abs(quantity_days) <= 3660),
  effective_date date NOT NULL,
  source_type text NOT NULL CHECK (char_length(source_type) BETWEEN 1 AND 40),
  source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 128),
  reverses_entry_id uuid NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT leave_balance_ledger_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT leave_balance_ledger_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT leave_balance_ledger_leave_type_fk
    FOREIGN KEY (installation_id, leave_type_id)
    REFERENCES shared.leave_types (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT leave_balance_ledger_reversal_fk
    FOREIGN KEY (installation_id, reverses_entry_id)
    REFERENCES shared.leave_balance_ledger (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT leave_balance_ledger_sign_check CHECK (
    (entry_type IN ('OPENING_GRANT', 'ACCRUAL', 'CARRY_OVER', 'COMPENSATORY') AND quantity_days > 0)
    OR (entry_type IN ('USAGE', 'EXPIRY') AND quantity_days < 0)
    OR entry_type IN ('ADJUSTMENT', 'REVERSAL')
  ),
  CONSTRAINT leave_balance_ledger_reversal_check CHECK (
    (entry_type = 'REVERSAL' AND reverses_entry_id IS NOT NULL)
    OR (entry_type <> 'REVERSAL' AND reverses_entry_id IS NULL)
  ),
  CONSTRAINT leave_balance_ledger_source_unique
    UNIQUE (installation_id, source_type, source_id, effective_date, entry_type)
);

CREATE INDEX IF NOT EXISTS leave_balance_ledger_balance_idx
  ON shared.leave_balance_ledger (installation_id, employee_id, leave_type_id, effective_date, created_at);

CREATE INDEX IF NOT EXISTS leave_balance_ledger_source_idx
  ON shared.leave_balance_ledger (installation_id, source_type, source_id, created_at);

CREATE OR REPLACE FUNCTION shared.reject_leave_balance_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'leave_balance_ledger_is_append_only';
END;
$$;

DROP TRIGGER IF EXISTS leave_balance_ledger_append_only ON shared.leave_balance_ledger;
CREATE TRIGGER leave_balance_ledger_append_only
BEFORE UPDATE OR DELETE ON shared.leave_balance_ledger
FOR EACH ROW EXECUTE FUNCTION shared.reject_leave_balance_history_mutation();

COMMENT ON TABLE shared.leave_balance_ledger IS
  'Append-only leave balance ledger. Current and historical balances are rebuilt from signed dated entries; no mutable remaining_leave field exists.';
