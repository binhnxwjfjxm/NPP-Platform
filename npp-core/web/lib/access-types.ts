export type AccessPermission = {
  permission_key: string;
  module: string;
  label: string;
  description: string;
  is_system: boolean;
  created_at: string;
};

export type AccessRole = {
  id: string;
  installation_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  permission_keys: string[];
};

export type AccessSnapshot = {
  permissions: AccessPermission[];
  roles: AccessRole[];
  checkedAt: string;
};

export function createEmptyAccessSnapshot(checkedAt = new Date().toISOString()): AccessSnapshot {
  return {
    permissions: [],
    roles: [],
    checkedAt,
  };
}
