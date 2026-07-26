-- Phase 3.2C: Access users and role assignments
-- Canonical internal user accounts linked to active employees and installation-scoped roles.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.user.read', 'Nhân sự', 'Xem người dùng', 'Cho phép đọc thông tin định danh người dùng và liên kết vai trò/nhân viên.', true, now()),
  ('core.user.write', 'Nhân sự', 'Quản lý người dùng', 'Cho phép tạo, cập nhật và quản lý liên kết vai trò/nhân viên của người dùng.', true, now()),
  ('core.user-role.write', 'Nhân sự', 'Quản lý liên kết vai trò người dùng', 'Cho phép thay thế toàn bộ tập vai trò của người dùng một cách nguyên tử.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS shared.users (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  employee_id uuid NOT NULL,
  login_name text NOT NULL CHECK (
    char_length(login_name) BETWEEN 1 AND 128
    AND login_name = lower(login_name)
    AND login_name ~ '^[a-z0-9._-]+$'
  ),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT users_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT users_installation_employee_unique UNIQUE (installation_id, employee_id),
  CONSTRAINT users_installation_login_unique UNIQUE (installation_id, login_name),
  CONSTRAINT users_employee_fk
    FOREIGN KEY (installation_id, employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS users_installation_idx
  ON shared.users (installation_id);

CREATE INDEX IF NOT EXISTS users_installation_active_idx
  ON shared.users (installation_id, is_active);

CREATE INDEX IF NOT EXISTS users_updated_at_idx
  ON shared.users (updated_at DESC);

CREATE OR REPLACE FUNCTION shared.prevent_users_login_employee_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.login_name IS DISTINCT FROM OLD.login_name
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'login_name and employee_id are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_login_employee_immutable ON shared.users;
CREATE TRIGGER users_login_employee_immutable
BEFORE UPDATE ON shared.users
FOR EACH ROW
EXECUTE FUNCTION shared.prevent_users_login_employee_update();

CREATE TABLE IF NOT EXISTS shared.user_roles (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, user_id, role_id),
  CONSTRAINT user_roles_user_fk
    FOREIGN KEY (installation_id, user_id)
    REFERENCES shared.users (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  CONSTRAINT user_roles_role_fk
    FOREIGN KEY (installation_id, role_id)
    REFERENCES shared.roles (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS user_roles_user_idx
  ON shared.user_roles (installation_id, user_id);

CREATE INDEX IF NOT EXISTS user_roles_role_idx
  ON shared.user_roles (installation_id, role_id);
