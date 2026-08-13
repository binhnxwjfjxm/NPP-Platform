-- Issue #497 G4: canonical employee linkage for logistics driver profiles.
-- Legacy rows are intentionally not rewritten in this migration. Public create/list/plan/lock
-- boundaries enforce active canonical employee linkage immediately; production must audit legacy
-- null/orphan/duplicate links before validating or strengthening the constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'driver_profiles_employee_fk'
       AND conrelid = 'logistics.driver_profiles'::regclass
  ) THEN
    ALTER TABLE logistics.driver_profiles
      ADD CONSTRAINT driver_profiles_employee_fk
      FOREIGN KEY (installation_id, employee_id)
      REFERENCES shared.employees (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS driver_profiles_employee_lookup_idx
  ON logistics.driver_profiles (installation_id, employee_id, is_active)
  WHERE employee_id IS NOT NULL;
