-- Issue #1140 Lô 1: effective-dated employment and branch assignment history.
-- Additive source migration only. Production execution remains a separately approved operation.
-- Legacy backfill is deliberately provenance-aware: estimates are never presented as confirmed HR facts.

CREATE TABLE IF NOT EXISTS shared.employee_employments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  employment_type text NOT NULL DEFAULT 'OTHER'
    CHECK (employment_type IN ('PROBATION', 'PERMANENT', 'FIXED_TERM', 'PART_TIME', 'TEMPORARY', 'OTHER')),
  effective_from date NOT NULL,
  effective_to date NULL,
  end_reason text NULL CHECK (end_reason IS NULL OR char_length(btrim(end_reason)) BETWEEN 1 AND 1000),
  data_quality text NOT NULL DEFAULT 'CONFIRMED'
    CHECK (data_quality IN ('CONFIRMED', 'AUDIT_DERIVED', 'LEGACY_ESTIMATED')),
  source text NOT NULL DEFAULT 'HR'
    CHECK (source IN ('HR', 'MIGRATION', 'SYSTEM')),
  source_reference text NULL CHECK (source_reference IS NULL OR char_length(source_reference) <= 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT employee_employments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT employee_employments_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT employee_employments_range_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_employments_start_unique
    UNIQUE (installation_id, employee_id, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_employments_one_open_idx
  ON shared.employee_employments (installation_id, employee_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS employee_employments_lookup_idx
  ON shared.employee_employments (installation_id, employee_id, effective_from DESC, effective_to);

CREATE TABLE IF NOT EXISTS shared.employee_assignments (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  branch_id uuid NULL,
  effective_from date NOT NULL,
  effective_to date NULL,
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
  data_quality text NOT NULL DEFAULT 'CONFIRMED'
    CHECK (data_quality IN ('CONFIRMED', 'AUDIT_DERIVED', 'LEGACY_CURRENT_ONLY')),
  source text NOT NULL DEFAULT 'HR'
    CHECK (source IN ('HR', 'MIGRATION', 'SYSTEM')),
  source_reference text NULL CHECK (source_reference IS NULL OR char_length(source_reference) <= 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT employee_assignments_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT employee_assignments_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT employee_assignments_branch_fk
    FOREIGN KEY (installation_id, branch_id)
    REFERENCES shared.branches (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT employee_assignments_range_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_assignments_start_unique
    UNIQUE (installation_id, employee_id, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_assignments_one_open_idx
  ON shared.employee_assignments (installation_id, employee_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS employee_assignments_lookup_idx
  ON shared.employee_assignments (installation_id, employee_id, effective_from DESC, effective_to, branch_id);

CREATE INDEX IF NOT EXISTS employee_assignments_branch_date_idx
  ON shared.employee_assignments (installation_id, branch_id, effective_from, effective_to, employee_id);

-- Employment backfill. created_at/updated_at only prove system-record timing, not the real-world
-- employment dates, therefore every derived row stays LEGACY_ESTIMATED until HR confirms it.
INSERT INTO shared.employee_employments (
  id, installation_id, employee_id, employment_type,
  effective_from, effective_to, end_reason,
  data_quality, source, source_reference, created_at, created_by
)
SELECT
  gen_random_uuid(),
  e.installation_id,
  e.id,
  'OTHER',
  (e.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
  CASE
    WHEN e.is_active THEN NULL
    ELSE GREATEST(
      (e.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
      (e.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    )
  END,
  CASE WHEN e.is_active THEN NULL ELSE 'Dữ liệu cũ: ngày kết thúc ước tính theo lần cập nhật hồ sơ cuối' END,
  'LEGACY_ESTIMATED',
  'MIGRATION',
  'shared.employees.created_at/updated_at',
  now(),
  'migration:149_workforce_employee_history'
FROM shared.employees e
WHERE NOT EXISTS (
  SELECT 1
  FROM shared.employee_employments x
  WHERE x.installation_id = e.installation_id
    AND x.employee_id = e.id
);

-- Rebuild branch history only where the audit trail actually contains branch snapshots.
-- One final snapshot per employee/day is enough because the effective-date contract has day granularity.
WITH audited AS (
  SELECT DISTINCT ON (
    a.installation_id,
    a.resource_id,
    (a.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
  )
    a.installation_id,
    e.id AS employee_id,
    NULLIF(a.after_data->>'branch_id', '')::uuid AS branch_id,
    (a.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS effective_from,
    a.audit_id::text AS audit_reference
  FROM shared.core_audit_records a
  JOIN shared.employees e
    ON e.installation_id = a.installation_id
   AND e.id::text = a.resource_id
  WHERE a.resource_type = 'employee'
    AND a.after_data ? 'branch_id'
    AND (
      NULLIF(a.after_data->>'branch_id', '') IS NULL
      OR NULLIF(a.after_data->>'branch_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
  ORDER BY
    a.installation_id,
    a.resource_id,
    (a.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
    a.occurred_at DESC,
    a.audit_id DESC
),
segmented AS (
  SELECT
    installation_id,
    employee_id,
    branch_id,
    effective_from,
    (LEAD(effective_from) OVER (
      PARTITION BY installation_id, employee_id
      ORDER BY effective_from
    ) - 1) AS effective_to,
    audit_reference
  FROM audited
)
INSERT INTO shared.employee_assignments (
  id, installation_id, employee_id, branch_id,
  effective_from, effective_to, reason,
  data_quality, source, source_reference, created_at, created_by
)
SELECT
  gen_random_uuid(),
  s.installation_id,
  s.employee_id,
  s.branch_id,
  s.effective_from,
  s.effective_to,
  'Khôi phục từ lịch sử audit hồ sơ nhân sự',
  'AUDIT_DERIVED',
  'MIGRATION',
  'audit:' || s.audit_reference,
  now(),
  'migration:149_workforce_employee_history'
FROM segmented s
WHERE NOT EXISTS (
  SELECT 1
  FROM shared.employee_assignments x
  WHERE x.installation_id = s.installation_id
    AND x.employee_id = s.employee_id
    AND x.effective_from = s.effective_from
)
ON CONFLICT (installation_id, employee_id, effective_from) DO NOTHING;

-- If there is no auditable branch fact for the current branch, create a current-day-only
-- compatibility snapshot. It must never be projected into earlier history.
WITH today_value AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date
),
to_close AS (
  SELECT a.id, a.installation_id, a.employee_id
  FROM shared.employee_assignments a
  JOIN shared.employees e
    ON e.installation_id = a.installation_id
   AND e.id = a.employee_id
  CROSS JOIN today_value d
  WHERE a.effective_to IS NULL
    AND a.effective_from < d.business_date
    AND a.branch_id IS DISTINCT FROM e.branch_id
)
UPDATE shared.employee_assignments a
SET effective_to = d.business_date - 1
FROM to_close c, today_value d
WHERE a.id = c.id
  AND a.installation_id = c.installation_id;

WITH today_value AS (
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS business_date
)
INSERT INTO shared.employee_assignments (
  id, installation_id, employee_id, branch_id,
  effective_from, effective_to, reason,
  data_quality, source, source_reference, created_at, created_by
)
SELECT
  gen_random_uuid(),
  e.installation_id,
  e.id,
  e.branch_id,
  d.business_date,
  NULL,
  'Dữ liệu cũ: chỉ xác nhận chi nhánh hiện tại tại ngày migration',
  'LEGACY_CURRENT_ONLY',
  'MIGRATION',
  'shared.employees.current-branch',
  now(),
  'migration:149_workforce_employee_history'
FROM shared.employees e
CROSS JOIN today_value d
WHERE NOT EXISTS (
  SELECT 1
  FROM shared.employee_assignments a
  WHERE a.installation_id = e.installation_id
    AND a.employee_id = e.id
    AND a.effective_from <= d.business_date
    AND (a.effective_to IS NULL OR a.effective_to >= d.business_date)
    AND a.branch_id IS NOT DISTINCT FROM e.branch_id
)
ON CONFLICT (installation_id, employee_id, effective_from) DO UPDATE
SET branch_id = EXCLUDED.branch_id,
    effective_to = NULL,
    reason = EXCLUDED.reason,
    data_quality = 'LEGACY_CURRENT_ONLY',
    source = 'MIGRATION',
    source_reference = EXCLUDED.source_reference;

COMMENT ON TABLE shared.employee_employments IS
  'Effective-dated employment periods. Legacy estimates remain explicitly unconfirmed until HR validates them.';
COMMENT ON TABLE shared.employee_assignments IS
  'Effective-dated employee branch assignment history. Current employee.branch_id is only a compatibility projection.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'shared' AND p.proname = 'grant_company_runtime_access')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'npp_company_runtime') THEN
    PERFORM shared.grant_company_runtime_access('npp_company_runtime'::name);
  END IF;
END;
$$;
