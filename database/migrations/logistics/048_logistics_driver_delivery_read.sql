-- Phase 6E.3: driver-scoped Delivery frontend read foundation.
-- No delivery attempt, POD, COD, production deployment or production migration is introduced here.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.delivery-trip.driver-read',
  'Giao hàng',
  'Xem chuyến được giao',
  'Cho phép tài xế đọc các chuyến đã xuất phát được gán đúng cho hồ sơ tài xế liên kết với nhân viên của mình.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'driver_profiles_employee_installation_fk'
       AND conrelid = 'logistics.driver_profiles'::regclass
  ) THEN
    ALTER TABLE logistics.driver_profiles
      ADD CONSTRAINT driver_profiles_employee_installation_fk
      FOREIGN KEY (installation_id, employee_id)
      REFERENCES shared.employees (installation_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS driver_profiles_employee_unique
  ON logistics.driver_profiles (installation_id, employee_id)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_trips_driver_status_idx
  ON logistics.delivery_trips (
    installation_id,
    primary_driver_id,
    status,
    dispatched_at DESC,
    id
  )
  WHERE primary_driver_id IS NOT NULL;
