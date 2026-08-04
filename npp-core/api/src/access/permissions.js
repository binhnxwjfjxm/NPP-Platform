import {
  PERMISSIONS as BASE_PERMISSIONS,
  PERMISSION_CATALOG as BASE_PERMISSION_CATALOG,
} from './permissions-sales.js';

export const PERMISSIONS = Object.freeze({
  ...BASE_PERMISSIONS,
  coreLogisticsRouteRead: 'core.logistics-route.read',
  coreLogisticsRouteManage: 'core.logistics-route.manage',
  coreVehicleRead: 'core.vehicle.read',
  coreVehicleManage: 'core.vehicle.manage',
  coreDriverProfileRead: 'core.driver-profile.read',
  coreDriverProfileManage: 'core.driver-profile.manage',
  coreDeliveryTripRead: 'core.delivery-trip.read',
  coreDeliveryTripCreate: 'core.delivery-trip.create',
  coreDeliveryTripPlan: 'core.delivery-trip.plan',
  coreDeliveryTripAssign: 'core.delivery-trip.assign',
  coreDeliveryTripLock: 'core.delivery-trip.lock',
});

const LOGISTICS_PERMISSION_CATALOG = Object.freeze([
  ['coreLogisticsRouteRead', 'Xem tuyến giao hàng', 'Cho phép đọc tuyến giao hàng trong installation hiện tại.'],
  ['coreLogisticsRouteManage', 'Quản lý tuyến giao hàng', 'Cho phép tạo tuyến giao hàng phục vụ lập kế hoạch chuyến.'],
  ['coreVehicleRead', 'Xem phương tiện', 'Cho phép đọc danh mục phương tiện giao hàng.'],
  ['coreVehicleManage', 'Quản lý phương tiện', 'Cho phép tạo phương tiện giao hàng phục vụ điều phối.'],
  ['coreDriverProfileRead', 'Xem tài xế', 'Cho phép đọc hồ sơ tài xế giao hàng.'],
  ['coreDriverProfileManage', 'Quản lý tài xế', 'Cho phép tạo hồ sơ tài xế giao hàng.'],
  ['coreDeliveryTripRead', 'Xem chuyến giao', 'Cho phép đọc chuyến, điểm dừng và phiếu giao được gán trong phạm vi kho.'],
  ['coreDeliveryTripCreate', 'Tạo chuyến giao', 'Cho phép tạo chuyến giao nháp trong phạm vi kho.'],
  ['coreDeliveryTripPlan', 'Lập kế hoạch chuyến', 'Cho phép cập nhật xe, tài xế, thời gian và trạng thái planned của chuyến.'],
  ['coreDeliveryTripAssign', 'Gán phiếu giao vào chuyến', 'Cho phép gán, bỏ gán và xếp thứ tự điểm dừng trước khi khóa.'],
  ['coreDeliveryTripLock', 'Khóa kế hoạch chuyến', 'Cho phép khóa kế hoạch chuyến đã đủ xe, tài xế và phiếu giao.'],
].map(([key, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key],
  module: 'Điều phối giao hàng',
  label,
  description,
  isSystem: true,
})));

export const PERMISSION_CATALOG = Object.freeze([
  ...BASE_PERMISSION_CATALOG,
  ...LOGISTICS_PERMISSION_CATALOG,
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
