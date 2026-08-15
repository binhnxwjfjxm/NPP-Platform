import type { AccessPermission } from '../../../lib/access-types';

export type RolePreset = Readonly<{
  id: string;
  label: string;
  description: string;
}>;

const INTERNAL_VERIFICATION_PERMISSIONS = new Set([
  'core.audit-outbox.test.write',
  'core.idempotency.test.write',
  'core.storage.r2.test.write',
]);

export const ROLE_PRESETS: readonly RolePreset[] = Object.freeze([
  { id: 'owner-admin', label: 'Quản trị hệ thống', description: 'Gợi ý toàn bộ quyền nghiệp vụ hiện có; vẫn có thể bỏ từng quyền trước khi lưu.' },
  { id: 'manager-auditor', label: 'Quản lý / Kiểm soát', description: 'Gợi ý quyền đọc và báo cáo để quan sát, đối soát, không mặc định cấp quyền ghi.' },
  { id: 'sales-manager', label: 'Quản lý bán hàng', description: 'Đơn bán hàng, khách hàng, giá, đề nghị mở mã khách và báo cáo bán hàng.' },
  { id: 'sales-rep', label: 'Nhân viên bán hàng', description: 'Đọc dữ liệu bán hàng, tạo/sửa đơn nháp và gửi đề nghị mở mã khách.' },
  { id: 'purchasing', label: 'Mua hàng', description: 'Nhà cung cấp, bảng giá mua, đơn mua hàng, nhận hàng và trả nhà cung cấp.' },
  { id: 'warehouse-manager', label: 'Quản lý kho', description: 'Tồn kho, chuyển kho, kiểm kê, điều chỉnh, giá vốn và chuẩn bị hàng.' },
  { id: 'warehouse-operator', label: 'Nhân viên kho', description: 'Đọc kho, soạn/đóng gói, nhận chuyển kho và ghi số đếm kiểm kê.' },
  { id: 'accounting', label: 'Kế toán phải thu / phải trả', description: 'Phải thu, phải trả, thanh toán, phân bổ, thu hộ khi giao hàng (COD) và báo cáo công nợ.' },
  { id: 'dispatcher', label: 'Điều phối giao hàng', description: 'Tuyến, xe, tài xế, lập/xếp chuyến và điều phối xuất phát.' },
  { id: 'driver-delivery', label: 'Tài xế / Giao hàng', description: 'Chuyến được giao, kết quả giao, bằng chứng giao hàng và thu/bàn giao COD.' },
  { id: 'mcp-field', label: 'Nhân viên thị trường', description: 'Đọc danh mục và khách hàng, gửi đề nghị mở mã khách và tiếp nhận đơn Công Ty theo phạm vi được giao.' },
  { id: 'logistics-manager', label: 'Quản lý giao vận', description: 'Toàn bộ điều phối, giao nhận, đối soát chuyến và báo cáo giao vận/COD.' },
]);

function isReadLike(key: string) {
  return key.endsWith('.read') || key.endsWith('.driver-read') || key.endsWith('.reconciliation-read');
}

function matchesAnyPrefix(key: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => key.startsWith(prefix));
}

function matchesAnyKey(key: string, keys: readonly string[]) {
  return keys.includes(key);
}

export function resolveRolePresetPermissionKeys(presetId: string, permissions: readonly AccessPermission[]) {
  const available = permissions.filter((permission) => !INTERNAL_VERIFICATION_PERMISSIONS.has(permission.permission_key));

  const predicate = (permission: AccessPermission) => {
    const key = permission.permission_key;
    switch (presetId) {
      case 'owner-admin':
        return true;
      case 'manager-auditor':
        return isReadLike(key) || key.startsWith('core.reporting.');
      case 'sales-manager':
        return matchesAnyPrefix(key, ['core.sales-order.', 'core.customer-onboarding.'])
          || matchesAnyKey(key, [
            'core.customer.read', 'core.customer.write', 'core.product.read', 'core.price.read',
            'core.fulfillment.read', 'core.fulfillment.configure-backorder', 'core.reporting.sales.read',
          ]);
      case 'sales-rep':
        return matchesAnyKey(key, [
          'core.customer.read', 'core.product.read', 'core.price.read',
          'core.sales-order.read', 'core.sales-order.create', 'core.sales-order.update-draft',
          'core.customer-onboarding.read', 'core.customer-onboarding.submit',
        ]);
      case 'purchasing':
        return matchesAnyPrefix(key, [
          'core.supplier.', 'core.supplier-purchase-price.', 'core.purchase-order.',
          'core.goods-receipt.', 'core.supplier-return.',
        ]) || key === 'core.reporting.purchasing.read';
      case 'warehouse-manager':
        return matchesAnyPrefix(key, [
          'core.inventory.', 'core.inventory-transfer.', 'core.inventory-adjustment.',
          'core.inventory-cost.', 'core.stocktake.', 'core.fulfillment.', 'core.delivery-order.',
        ]) || key === 'core.reporting.inventory.read';
      case 'warehouse-operator':
        return matchesAnyKey(key, [
          'core.inventory.read', 'core.inventory-tracking-policy.read', 'core.inventory-lot.read',
          'core.inventory-transfer.read', 'core.inventory-transfer.receive',
          'core.stocktake.read', 'core.stocktake.count',
          'core.fulfillment.read', 'core.fulfillment.allocate', 'core.fulfillment.pick', 'core.fulfillment.pack',
          'core.delivery-order.read',
        ]);
      case 'accounting':
        return matchesAnyPrefix(key, [
          'core.receivable.', 'core.receivable-allocation.', 'core.customer-payment.',
          'core.customer-return-credit.', 'core.customer-refund.', 'core.payable.',
          'core.payable-allocation.', 'core.supplier-payment.', 'core.cod-',
        ]) || matchesAnyKey(key, ['core.reporting.aging.read', 'core.reporting.cod.read']);
      case 'dispatcher':
        return matchesAnyPrefix(key, ['core.logistics-route.', 'core.vehicle.', 'core.driver-profile.'])
          || matchesAnyKey(key, [
            'core.delivery-trip.read', 'core.delivery-trip.create', 'core.delivery-trip.plan',
            'core.delivery-trip.assign', 'core.delivery-trip.lock', 'core.delivery-trip.dispatch',
            'core.delivery-order.read', 'core.reporting.logistics.read',
          ]);
      case 'driver-delivery':
        return matchesAnyKey(key, [
          'core.delivery-trip.driver-read', 'core.delivery-attempt.read', 'core.delivery-attempt.record',
          'core.pod.read', 'core.pod.attach', 'core.cod-collection.read', 'core.cod-collection.record',
          'core.cod-handover.read', 'core.cod-handover.create',
        ]);
      case 'mcp-field':
        return matchesAnyKey(key, [
          'core.customer.read', 'core.product.read', 'core.price.read',
          'core.customer-onboarding.read', 'core.customer-onboarding.submit',
          'core.sales-order.read', 'core.sales-order.create',
        ]);
      case 'logistics-manager':
        return matchesAnyPrefix(key, [
          'core.logistics-route.', 'core.vehicle.', 'core.driver-profile.', 'core.delivery-trip.',
          'core.delivery-attempt.', 'core.pod.', 'core.delivery-order.', 'core.cod-',
        ]) || matchesAnyKey(key, ['core.reporting.logistics.read', 'core.reporting.cod.read']);
      default:
        return false;
    }
  };

  return available.filter(predicate).map((permission) => permission.permission_key);
}
