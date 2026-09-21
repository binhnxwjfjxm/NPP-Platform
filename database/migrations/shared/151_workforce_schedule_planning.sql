-- Issue #1140 Lô 3: ca mẫu, lịch tuần, ngày lễ/ngày nghỉ Công Ty.
-- Additive source migration only. Production execution remains a separately approved operation.
-- work_schedules remains the materialized employee/day source; templates never rewrite historical rows implicitly.

CREATE TABLE IF NOT EXISTS shared.work_shift_templates (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  start_time time NOT NULL,
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT work_shift_templates_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT work_shift_templates_code_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS work_shift_templates_active_idx
  ON shared.work_shift_templates (installation_id, is_active, code);

CREATE TABLE IF NOT EXISTS shared.work_week_templates (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT work_week_templates_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT work_week_templates_code_unique UNIQUE (installation_id, code)
);

CREATE INDEX IF NOT EXISTS work_week_templates_active_idx
  ON shared.work_week_templates (installation_id, is_active, code);

CREATE TABLE IF NOT EXISTS shared.work_week_template_days (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  week_template_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  schedule_kind text NOT NULL CHECK (schedule_kind IN ('WORK', 'OFF')),
  shift_template_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT work_week_template_days_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT work_week_template_days_weekday_unique UNIQUE (installation_id, week_template_id, weekday),
  CONSTRAINT work_week_template_days_week_fk
    FOREIGN KEY (installation_id, week_template_id)
    REFERENCES shared.work_week_templates (installation_id, id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT work_week_template_days_shift_fk
    FOREIGN KEY (installation_id, shift_template_id)
    REFERENCES shared.work_shift_templates (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT work_week_template_days_kind_check CHECK (
    (schedule_kind = 'WORK' AND shift_template_id IS NOT NULL)
    OR (schedule_kind = 'OFF' AND shift_template_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS work_week_template_days_lookup_idx
  ON shared.work_week_template_days (installation_id, week_template_id, weekday);

CREATE TABLE IF NOT EXISTS shared.company_calendar_days (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  calendar_date date NOT NULL,
  calendar_kind text NOT NULL CHECK (calendar_kind IN ('PUBLIC_HOLIDAY', 'COMPANY_DAY_OFF')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 256),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT company_calendar_days_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT company_calendar_days_date_unique UNIQUE (installation_id, calendar_date)
);

CREATE INDEX IF NOT EXISTS company_calendar_days_active_date_idx
  ON shared.company_calendar_days (installation_id, is_active, calendar_date);

ALTER TABLE shared.work_schedules
  ADD COLUMN IF NOT EXISTS shift_template_id uuid NULL,
  ADD COLUMN IF NOT EXISTS week_template_id uuid NULL,
  ADD COLUMN IF NOT EXISTS company_calendar_day_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_schedules_shift_template_fk'
      AND conrelid = 'shared.work_schedules'::regclass
  ) THEN
    ALTER TABLE shared.work_schedules
      ADD CONSTRAINT work_schedules_shift_template_fk
      FOREIGN KEY (installation_id, shift_template_id)
      REFERENCES shared.work_shift_templates (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_schedules_week_template_fk'
      AND conrelid = 'shared.work_schedules'::regclass
  ) THEN
    ALTER TABLE shared.work_schedules
      ADD CONSTRAINT work_schedules_week_template_fk
      FOREIGN KEY (installation_id, week_template_id)
      REFERENCES shared.work_week_templates (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_schedules_company_calendar_day_fk'
      AND conrelid = 'shared.work_schedules'::regclass
  ) THEN
    ALTER TABLE shared.work_schedules
      ADD CONSTRAINT work_schedules_company_calendar_day_fk
      FOREIGN KEY (installation_id, company_calendar_day_id)
      REFERENCES shared.company_calendar_days (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS work_schedules_template_provenance_idx
  ON shared.work_schedules (installation_id, week_template_id, work_date, employee_id)
  WHERE week_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_schedules_calendar_provenance_idx
  ON shared.work_schedules (installation_id, company_calendar_day_id, work_date, employee_id)
  WHERE company_calendar_day_id IS NOT NULL;

COMMENT ON TABLE shared.work_shift_templates IS
  'Reusable shift definitions. Editing a template does not mutate already materialized employee/day schedules.';
COMMENT ON TABLE shared.work_week_templates IS
  'Reusable weekly schedule definitions. Employee/day schedules remain the operational source after application.';
COMMENT ON TABLE shared.company_calendar_days IS
  'Company-wide public holidays and Company days off. A person/day OVERRIDE may supersede a Company day with audited reason.';
COMMENT ON COLUMN shared.work_schedules.shift_template_id IS
  'Optional provenance to the shift template used when a schedule row was materialized.';
COMMENT ON COLUMN shared.work_schedules.week_template_id IS
  'Optional provenance to the weekly template used when a schedule row was materialized.';
COMMENT ON COLUMN shared.work_schedules.company_calendar_day_id IS
  'Optional provenance to a Company calendar day applied while materializing the schedule.';

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
