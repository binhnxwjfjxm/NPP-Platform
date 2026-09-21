-- Issue #1110 Lô 10: attendance violation explanation and handling workflow.
-- Violation truth remains derived from Timesheet. This table stores only handling workflow + immutable submission snapshot.
-- Source migration only. Production execution remains a separate gated operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.attendance-violation.self-explain', 'Nhân sự', 'Giải trình vi phạm công', 'Cho phép nhân viên gửi giải trình cho vi phạm công hiện tại của chính mình.', true, now()),
  ('core.attendance-violation.resolve', 'Nhân sự', 'Xử lý vi phạm công', 'Cho phép quản lý xem xét và kết luận hồ sơ giải trình vi phạm công trong phạm vi được cấp.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.attendance_violation_cases (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  violation_kind text NOT NULL CHECK (violation_kind IN ('LATE', 'EARLY_LEAVE', 'MISSING_ATTENDANCE', 'UNEXCUSED_ABSENCE')),
  violation_label_snapshot text NOT NULL CHECK (char_length(btrim(violation_label_snapshot)) BETWEEN 1 AND 100),
  violation_detail_snapshot text NOT NULL CHECK (char_length(btrim(violation_detail_snapshot)) BETWEEN 1 AND 1000),
  violation_minutes_snapshot integer NULL CHECK (violation_minutes_snapshot IS NULL OR violation_minutes_snapshot >= 0),
  violation_day_fraction_snapshot numeric(4,3) NULL CHECK (
    violation_day_fraction_snapshot IS NULL
    OR (violation_day_fraction_snapshot > 0 AND violation_day_fraction_snapshot <= 1)
  ),
  policy_id_snapshot uuid NULL,
  policy_version_snapshot integer NULL CHECK (policy_version_snapshot IS NULL OR policy_version_snapshot >= 1),
  status text NOT NULL CHECK (status IN ('EXPLANATION_SUBMITTED', 'UNDER_REVIEW', 'RESOLVED')),
  explanation text NOT NULL CHECK (char_length(btrim(explanation)) BETWEEN 1 AND 2000),
  explained_by_actor_id text NOT NULL CHECK (char_length(explained_by_actor_id) BETWEEN 1 AND 128),
  explained_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_actor_id text NULL CHECK (reviewed_by_actor_id IS NULL OR char_length(reviewed_by_actor_id) BETWEEN 1 AND 128),
  review_note text NULL CHECK (review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 1 AND 2000),
  reviewed_at timestamptz NULL,
  outcome text NULL CHECK (outcome IN ('CONFIRMED', 'EXCUSED')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_violation_cases_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT attendance_violation_cases_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT attendance_violation_cases_one_case_per_fact UNIQUE (
    installation_id, employee_id, work_date, violation_kind
  ),
  CONSTRAINT attendance_violation_cases_state_check CHECK (
    (status = 'EXPLANATION_SUBMITTED'
      AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL
      AND review_note IS NULL AND outcome IS NULL)
    OR
    (status = 'UNDER_REVIEW'
      AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NULL
      AND outcome IS NULL)
    OR
    (status = 'RESOLVED'
      AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL
      AND review_note IS NOT NULL AND outcome IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS attendance_violation_cases_employee_period_idx
  ON shared.attendance_violation_cases (installation_id, employee_id, work_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS attendance_violation_cases_status_period_idx
  ON shared.attendance_violation_cases (installation_id, status, work_date DESC, created_at DESC);

COMMENT ON TABLE shared.attendance_violation_cases IS
  'Workflow-only attendance violation explanation/review cases. Violation facts remain derived from canonical Timesheet sources.';
