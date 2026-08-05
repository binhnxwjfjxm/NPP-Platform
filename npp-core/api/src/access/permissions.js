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
  coreDeliveryTripDispatch: 'core.delivery-trip.dispatch',
  coreDeliveryTripDriverRead: 'core.delivery-trip.driver-read',
  coreDeliveryAttemptRead: 'core.delivery-attempt.read',
  coreDeliveryAttemptRecord: 'core.delivery-attempt.record',
  corePodRead: 'core.pod.read',
  corePodAttach: 'core.pod.attach',
  coreDeliveryTripReconciliationRead: 'core.delivery-trip.reconciliation-read',
  coreDeliveryTripReturnReceive: 'core.delivery-trip.return-receive',
  coreDeliveryTripClose: 'core.delivery-trip.close',
});

const LOGISTICS_PERMISSION_CATALOG = Object.freeze([
  ['coreLogisticsRouteRead', 'Điều phối giao hàng', 'Xem tuyến giao hàng', 'Cho phép đọc tuyến giao hàng trong installation hiện tại.'],
  ['coreLogisticsRouteManage', 'Điều phối giao hàng', 'Quản lý tuyến giao hàng', 'Cho phép tạo tuyến giao hàng phục vụ lập kế hoạch chuyến.'],
  ['coreVehicleRead', 'Điều phối giao hàng', 'Xem phương tiện', 'Cho phép đọc danh mục phương tiện giao hàng.'],
  ['coreVehicleManage', 'Điều phối giao hàng', 'Quản lý phương tiện', 'Cho phép tạo phương tiện giao hàng phục vụ điều phối.'],
  ['coreDriverProfileRead', 'Điều phối giao hàng', 'Xem tài xế', 'Cho phép đọc hồ sơ tài xế giao hàng.'],
  ['coreDriverProfileManage', 'Điều phối giao hàng', 'Quản lý tài xế', 'Cho phép tạo hồ sơ tài xế giao hàng.'],
  ['coreDeliveryTripRead', 'Điều phối giao hàng', 'Xem chuyến giao', 'Cho phép đọc chuyến, điểm dừng và phiếu giao được gán trong phạm vi kho.'],
  ['coreDeliveryTripCreate', 'Điều phối giao hàng', 'Tạo chuyến giao', 'Cho phép tạo chuyến giao nháp trong phạm vi kho.'],
  ['coreDeliveryTripPlan', 'Điều phối giao hàng', 'Lập kế hoạch chuyến', 'Cho phép cập nhật xe, tài xế, thời gian và trạng thái planned của chuyến.'],
  ['coreDeliveryTripAssign', 'Điều phối giao hàng', 'Gán phiếu giao vào chuyến', 'Cho phép gán, bỏ gán và xếp thứ tự điểm dừng trước khi khóa.'],
  ['coreDeliveryTripLock', 'Điều phối giao hàng', 'Khóa kế hoạch chuyến', 'Cho phép khóa kế hoạch chuyến đã đủ xe, tài xế và phiếu giao.'],
  ['coreDeliveryTripDispatch', 'Điều phối giao hàng', 'Bàn giao và cho chuyến xuất phát', 'Cho phép xác nhận bàn giao vật lý, ghi Inventory OUT cho toàn bộ Delivery Order và chuyển chuyến đã khóa sang dispatched.'],
  ['coreDeliveryTripDriverRead', 'Giao hàng', 'Xem chuyến được giao', 'Cho phép tài xế đọc các chuyến đã xuất phát được gán đúng cho hồ sơ tài xế liên kết với nhân viên của mình.'],
  ['coreDeliveryAttemptRead', 'Giao hàng', 'Xem kết quả lần giao', 'Cho phép đọc kết quả lần giao trong phạm vi chuyến và kho được cấp quyền.'],
  ['coreDeliveryAttemptRecord', 'Giao hàng', 'Ghi kết quả lần giao', 'Cho phép tài xế được xác thực ghi đúng một kết quả terminal cho assignment thuộc chuyến của mình.'],
  ['corePodRead', 'Giao hàng', 'Xem bằng chứng giao hàng', 'Cho phép đọc POD gắn với delivery attempt trong phạm vi tài xế hoặc kho được cấp quyền.'],
  ['corePodAttach', 'Giao hàng', 'Đính kèm bằng chứng giao hàng', 'Cho phép tài xế đã xác thực đính kèm POD tùy chọn vào delivery attempt thuộc chuyến của mình.'],
  ['coreDeliveryTripReconciliationRead', 'Đối soát giao hàng', 'Xem đối soát cuối chuyến', 'Cho phép đọc số đã xuất, đã giao, đã nhận lại và còn trên xe trong phạm vi kho.'],
  ['coreDeliveryTripReturnReceive', 'Đối soát giao hàng', 'Nhận hàng chưa giao về kho', 'Cho phép kho xác nhận thực nhận hàng chưa giao và ghi Inventory IN theo exact issue-line lineage.'],
  ['coreDeliveryTripClose', 'Đối soát giao hàng', 'Đóng chuyến đã đối soát', 'Cho phép đóng chuyến khi mọi phiếu có kết quả và toàn bộ hàng đã giao hoặc đã nhận lại kho.'],
].map(([key, module, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key],
  module,
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
