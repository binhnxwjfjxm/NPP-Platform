BEGIN;

ALTER TABLE shared.work_policies
  ADD COLUMN IF NOT EXISTS attendance_basis text;

UPDATE shared.work_policies
   SET attendance_basis = CASE
     WHEN time_mode = 'NO_ATTENDANCE' OR attendance_method = 'NONE' THEN 'NONE'
     ELSE 'TIME'
   END
 WHERE attendance_basis IS NULL;

ALTER TABLE shared.work_policies
  ALTER COLUMN attendance_basis SET DEFAULT 'TIME',
  ALTER COLUMN attendance_basis SET NOT NULL;

ALTER TABLE shared.work_policies
  DROP CONSTRAINT IF EXISTS work_policies_attendance_basis_check,
  ADD CONSTRAINT work_policies_attendance_basis_check
    CHECK (attendance_basis IN ('TIME', 'PRESENCE', 'NONE'));

ALTER TABLE shared.work_policies
  DROP CONSTRAINT IF EXISTS work_policies_no_attendance_check,
  ADD CONSTRAINT work_policies_no_attendance_check CHECK (
    (time_mode <> 'NO_ATTENDANCE' OR (attendance_method = 'NONE' AND attendance_basis = 'NONE'))
    AND (
      (attendance_method = 'NONE' AND attendance_basis = 'NONE')
      OR (attendance_method <> 'NONE' AND attendance_basis <> 'NONE')
    )
  );

ALTER TABLE shared.attendance_events
  ADD COLUMN IF NOT EXISTS movement_reason text;

ALTER TABLE shared.attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_event_type_check,
  ADD CONSTRAINT attendance_events_event_type_check
    CHECK (event_type IN ('CHECK_IN', 'TEMP_EXIT', 'RETURN', 'CHECK_OUT'));

ALTER TABLE shared.attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_movement_reason_check,
  ADD CONSTRAINT attendance_events_movement_reason_check CHECK (
    (event_type = 'TEMP_EXIT' AND movement_reason IN ('WORK_BUSINESS', 'PERSONAL', 'BREAK', 'OTHER'))
    OR
    (event_type <> 'TEMP_EXIT' AND movement_reason IS NULL)
  );

ALTER TABLE shared.attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_other_reason_note_check,
  ADD CONSTRAINT attendance_events_other_reason_note_check CHECK (
    movement_reason IS DISTINCT FROM 'OTHER'
    OR (note IS NOT NULL AND char_length(btrim(note)) BETWEEN 1 AND 1024)
  );

COMMENT ON COLUMN shared.work_policies.attendance_basis IS
  'TIME counts worked intervals; PRESENCE only confirms attendance without deriving pay/work time; NONE does not require attendance.';

COMMENT ON COLUMN shared.attendance_events.movement_reason IS
  'Reason for TEMP_EXIT only: WORK_BUSINESS, PERSONAL, BREAK, or OTHER. Attendance events remain append-only.';

COMMIT;
