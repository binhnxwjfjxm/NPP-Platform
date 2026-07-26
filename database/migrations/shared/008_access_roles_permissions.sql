-- Phase 3.2B: Access roles and permissions foundation
-- Canonical permission catalog plus installation-scoped roles and role-permission assignments.

CREATE TABLE IF NOT EXISTS shared.permission_catalog (
  permission_key text NOT NULL PRIMARY KEY,
  module text NOT NULL CHECK (char_length(module) BETWEEN 1 AND 128),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 256),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 512),
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.config.read', 'Hệ thống', 'Xem cấu hình hệ thống', 'Cho phép đọc thông tin cấu hình và trạng thái nền tảng đã được chuẩn hóa.', true, now()),
  ('core.health.authenticated.read', 'Hệ thống', 'Xem trạng thái xác thực', 'Cho phép đọc trạng thái sức khỏe có xác thực của Core API.', true, now()),
  ('core.idempotency.test.write', 'Hệ thống', 'Kiểm thử idempotency', 'Cho phép thực thi luồng kiểm thử idempotency ở tầng Core.', true, now()),
  ('core.audit-outbox.test.write', 'Hệ thống', 'Kiểm thử audit/outbox', 'Cho phép thực thi kiểm thử giao dịch audit và outbox của Core API.', true, now()),
  ('core.storage.r2.test.write', 'Hệ thống', 'Kiểm thử lưu trữ R2', 'Cho phép thực thi kiểm thử tích hợp lưu trữ đối tượng của Core.', true, now()),
  ('core.organization.read', 'Tổ chức', 'Xem cấu trúc tổ chức', 'Cho phép đọc tổng quan cơ cấu tổ chức và các đơn vị trực thuộc.', true, now()),
  ('core.organization.write', 'Tổ chức', 'Quản lý cấu trúc tổ chức', 'Cho phép chỉnh sửa thông tin tổng quan cơ cấu tổ chức.', true, now()),
  ('core.branch.read', 'Tổ chức', 'Xem chi nhánh', 'Cho phép đọc danh sách và chi tiết chi nhánh.', true, now()),
  ('core.branch.write', 'Tổ chức', 'Quản lý chi nhánh', 'Cho phép tạo, cập nhật và thay đổi trạng thái chi nhánh.', true, now()),
  ('core.warehouse.read', 'Tổ chức', 'Xem kho hàng', 'Cho phép đọc danh sách và chi tiết kho hàng.', true, now()),
  ('core.warehouse.write', 'Tổ chức', 'Quản lý kho hàng', 'Cho phép tạo, cập nhật và thay đổi trạng thái kho hàng.', true, now()),
  ('core.warehouse.location.read', 'Tổ chức', 'Xem vị trí kho', 'Cho phép đọc danh sách và chi tiết vị trí kho.', true, now()),
  ('core.warehouse.location.write', 'Tổ chức', 'Quản lý vị trí kho', 'Cho phép tạo, cập nhật và thay đổi trạng thái vị trí kho.', true, now()),
  ('core.employee.read', 'Nhân sự', 'Xem nhân sự', 'Cho phép đọc hồ sơ nhân sự nghiệp vụ.', true, now()),
  ('core.employee.write', 'Nhân sự', 'Quản lý nhân sự', 'Cho phép tạo, cập nhật và thay đổi trạng thái hồ sơ nhân sự.', true, now()),
  ('core.permission.read', 'Phân quyền', 'Xem danh mục quyền', 'Cho phép đọc danh mục quyền chuẩn hóa của Core Platform.', true, now()),
  ('core.role.read', 'Phân quyền', 'Xem vai trò', 'Cho phép đọc danh sách và chi tiết vai trò quản trị.', true, now()),
  ('core.role.write', 'Phân quyền', 'Quản lý vai trò', 'Cho phép tạo, cập nhật, bật/tắt và thay thế tập quyền của vai trò.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE INDEX IF NOT EXISTS permission_catalog_module_idx
  ON shared.permission_catalog (module, permission_key);

CREATE TABLE IF NOT EXISTS shared.roles (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 64 AND code ~ '^[A-Z0-9_-]{1,64}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 256),
  description text NULL CHECK (description IS NULL OR char_length(description) <= 512),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT roles_code_installation_unique
    UNIQUE (installation_id, code),
  CONSTRAINT roles_id_installation_unique
    UNIQUE (installation_id, id)
);

CREATE INDEX IF NOT EXISTS roles_installation_idx
  ON shared.roles (installation_id);

CREATE INDEX IF NOT EXISTS roles_installation_active_idx
  ON shared.roles (installation_id, is_active);

CREATE INDEX IF NOT EXISTS roles_installation_code_idx
  ON shared.roles (installation_id, code);

CREATE INDEX IF NOT EXISTS roles_updated_at_idx
  ON shared.roles (updated_at DESC);

CREATE OR REPLACE FUNCTION shared.prevent_roles_code_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'role code is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roles_code_immutable ON shared.roles;
CREATE TRIGGER roles_code_immutable
BEFORE UPDATE ON shared.roles
FOR EACH ROW
EXECUTE FUNCTION shared.prevent_roles_code_update();

CREATE TABLE IF NOT EXISTS shared.role_permissions (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  role_id uuid NOT NULL,
  permission_key text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL CHECK (char_length(granted_by) BETWEEN 1 AND 128),
  PRIMARY KEY (installation_id, role_id, permission_key),
  CONSTRAINT role_permissions_role_installation_fk
    FOREIGN KEY (installation_id, role_id)
    REFERENCES shared.roles (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE CASCADE,
  CONSTRAINT role_permissions_permission_catalog_fk
    FOREIGN KEY (permission_key)
    REFERENCES shared.permission_catalog (permission_key)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS role_permissions_role_idx
  ON shared.role_permissions (installation_id, role_id);

CREATE INDEX IF NOT EXISTS role_permissions_permission_idx
  ON shared.role_permissions (permission_key);
