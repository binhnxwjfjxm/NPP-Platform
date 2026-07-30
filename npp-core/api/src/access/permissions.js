import {
  PERMISSIONS as CORE_PERMISSIONS,
  PERMISSION_CATALOG as CORE_PERMISSION_CATALOG,
} from './permissions-core.js';

export const PERMISSIONS = Object.freeze({
  ...CORE_PERMISSIONS,
  corePayableRead: 'core.payable.read',
  coreSupplierPaymentRead: 'core.supplier-payment.read',
  coreSupplierPaymentCreate: 'core.supplier-payment.create',
  coreSupplierPaymentReverse: 'core.supplier-payment.reverse',
  corePayableAllocationCreate: 'core.payable-allocation.create',
  corePayableAllocationReverse: 'core.payable-allocation.reverse',
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
  Object.freeze({
    permissionKey: PERMISSIONS.coreSupplierPaymentRead,
    module: 'Thanh toán nhà cung cấp',
    label: 'Xem thanh toán nhà cung cấp',
    description: 'Cho phép đọc phiếu thanh toán nhà cung cấp trong phạm vi kho được cấp.',
    isSystem: true,
  }),
  Object.freeze({
    permissionKey: PERMISSIONS.coreSupplierPaymentCreate,
    module: 'Thanh toán nhà cung cấp',
    label: 'Ghi nhận thanh toán nhà cung cấp',
    description: 'Cho phép ghi nhận phiếu thanh toán nhà cung cấp đã post trong phạm vi kho được cấp.',
    isSystem: true,
  }),
  Object.freeze({
    permissionKey: PERMISSIONS.coreSupplierPaymentReverse,
    module: 'Thanh toán nhà cung cấp',
    label: 'Đảo thanh toán nhà cung cấp',
    description: 'Cho phép đảo phiếu thanh toán nhà cung cấp chưa có phân bổ đang hiệu lực.',
    isSystem: true,
  }),
  Object.freeze({
    permissionKey: PERMISSIONS.corePayableAllocationCreate,
    module: 'Công nợ phải trả',
    label: 'Phân bổ công nợ phải trả',
    description: 'Cho phép phân bổ thanh toán hoặc phiếu trả nhà cung cấp vào chứng từ phải trả.',
    isSystem: true,
  }),
  Object.freeze({
    permissionKey: PERMISSIONS.corePayableAllocationReverse,
    module: 'Công nợ phải trả',
    label: 'Đảo phân bổ công nợ phải trả',
    description: 'Cho phép đảo một phân bổ công nợ bằng chứng từ đảo bất biến.',
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
