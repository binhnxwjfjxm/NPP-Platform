import {
  PERMISSIONS as CORE_PERMISSIONS,
  PERMISSION_CATALOG as CORE_PERMISSION_CATALOG,
} from './permissions-core.js';

export const PERMISSIONS = Object.freeze({
  ...CORE_PERMISSIONS,
  corePayableRead: 'core.payable.read',
});

export const PERMISSION_CATALOG = Object.freeze([
  ...CORE_PERMISSION_CATALOG,
  Object.freeze({
    permissionKey: PERMISSIONS.corePayableRead,
    module: 'Công nợ phải trả',
    label: 'Xem công nợ phải trả',
    description: 'Cho phép đọc chứng từ, sổ chi tiết và số dư công nợ nhà cung cấp trong phạm vi kho được cấp.',
    isSystem: true,
  }),
]);

export const PERMISSION_REGISTRY = new Set(PERMISSION_CATALOG.map((entry) => entry.permissionKey));

export function isKnownPermissionKey(value) {
  return typeof value === 'string' && PERMISSION_REGISTRY.has(value);
}

export function createPermissionCatalogRows(occurredAt = new Date().toISOString()) {
  return PERMISSION_CATALOG.map((entry) => ({
    permission_key: entry.permissionKey,
    module: entry.module,
    label: entry.label,
    description: entry.description,
    is_system: entry.isSystem,
    created_at: occurredAt,
  }));
}
