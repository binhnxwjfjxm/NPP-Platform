ALTER TABLE shared.work_policies
  DROP CONSTRAINT IF EXISTS work_policies_attendance_method_check,
  ADD CONSTRAINT work_policies_attendance_method_check
    CHECK (attendance_method IN ('QR', 'MANUAL', 'BOTH', 'FACE', 'QR_FACE', 'FACE_MANUAL', 'ALL', 'NONE'));
