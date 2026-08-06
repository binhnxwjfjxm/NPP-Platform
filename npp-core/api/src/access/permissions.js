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
  coreReceivableRead: 'core.receivable.read',
  coreCustomerPaymentRead: 'core.customer-payment.read',
  coreCustomerPaymentCreate: 'core.customer-payment.create',
  coreCustomerPaymentReverse: 'core.customer-payment.reverse',
  coreReceivableAllocationCreate: 'core.receivable-allocation.create',
  coreReceivableAllocationReverse: 'core.receivable-allocation.reverse',
  coreCustomerReturnCreditRead: 'core.customer-return-credit.read',
  coreCustomerReturnCreditAllocate: 'core.customer-return-credit.allocate',
  coreCustomerReturnCreditReverse: 'core.customer-return-credit.reverse',
  coreCustomerRefundCreate: 'core.customer-refund.create',
  coreCustomerRefundReverse: 'core.customer-refund.reverse',
  coreCodCollectionRead: 'core.cod-collection.read',
  coreCodCollectionRecord: 'core.cod-collection.record',
  coreCodHandoverRead: 'core.cod-handover.read',
  coreCodHandoverCreate: 'core.cod-handover.create',
  coreCodReconciliationRead: 'core.cod-reconciliation.read',
  coreCodReconciliationAccept: 'core.cod-reconciliation.accept',
  coreCodAdjustmentCreate: 'core.cod-adjustment.create',
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
  ['coreCodCollectionRead', 'COD giao hàng', 'Xem tiền COD theo chuyến', 'Cho phép đọc tiền COD và số tiền tài xế đang giữ trong đúng phạm vi chuyến/kho.'],
  ['coreCodCollectionRecord', 'COD giao hàng', 'Ghi nhận tiền COD đã thu', 'Cho phép tài xế ghi tiền thực thu hoặc lời hẹn của đúng phiếu giao được giao.'],
  ['coreCodHandoverRead', 'COD giao hàng', 'Xem bàn giao tiền COD', 'Cho phép đọc các lần bàn giao tiền COD trong phạm vi được cấp.'],
  ['coreCodHandoverCreate', 'COD giao hàng', 'Lập bàn giao tiền COD', 'Cho phép tài xế lập bàn giao tiền mặt COD theo exact collection lineage.'],
].map(([key, module, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key], module, label, description, isSystem: true,
})));

const ACCOUNTING_PERMISSION_CATALOG = Object.freeze([
  ['coreReceivableRead', 'Công nợ khách hàng', 'Xem công nợ khách hàng', 'Cho phép đọc số dư, chứng từ và sổ chi tiết công nợ khách hàng trong phạm vi kho được cấp.'],
  ['coreCustomerPaymentRead', 'Thu tiền khách hàng', 'Xem phiếu thu khách hàng', 'Cho phép đọc phiếu thu và lịch sử phân bổ trong phạm vi kho được cấp.'],
  ['coreCustomerPaymentCreate', 'Thu tiền khách hàng', 'Ghi nhận tiền khách trả', 'Cho phép ghi nhận tiền mặt hoặc chuyển khoản đã thực nhận từ khách hàng.'],
  ['coreCustomerPaymentReverse', 'Thu tiền khách hàng', 'Đảo phiếu thu khách hàng', 'Cho phép đảo phiếu thu chưa còn phân bổ đang hiệu lực, với lý do bắt buộc.'],
  ['coreReceivableAllocationCreate', 'Công nợ khách hàng', 'Phân bổ tiền vào công nợ', 'Cho phép phân bổ một phiếu thu vào một hoặc nhiều chứng từ phải thu trong phạm vi được cấp.'],
  ['coreReceivableAllocationReverse', 'Công nợ khách hàng', 'Đảo phân bổ công nợ', 'Cho phép đảo một phân bổ bằng chứng từ đảo bất biến.'],
  ['coreCustomerReturnCreditRead', 'Điều chỉnh công nợ khách hàng', 'Xem credit hàng khách trả', 'Cho phép đọc credit phát sinh từ Customer Return đã được kho nhận trong phạm vi kho.'],
  ['coreCustomerReturnCreditAllocate', 'Điều chỉnh công nợ khách hàng', 'Phân bổ credit hàng khách trả', 'Cho phép phân bổ phần credit chưa dùng vào khoản phải thu hợp lệ.'],
  ['coreCustomerReturnCreditReverse', 'Điều chỉnh công nợ khách hàng', 'Đảo credit hàng khách trả', 'Cho phép đảo credit bằng bút toán bù sau khi hoàn tiền liên quan đã được đảo.'],
  ['coreCustomerRefundCreate', 'Hoàn tiền khách hàng', 'Hoàn tiền từ số dư credit', 'Cho phép ghi nhận hoàn tiền từ credit chưa phân bổ, với nơi nhận và lý do bắt buộc.'],
  ['coreCustomerRefundReverse', 'Hoàn tiền khách hàng', 'Đảo hoàn tiền khách hàng', 'Cho phép đảo một khoản hoàn tiền bằng bút toán bù bất biến.'],
  ['coreCodReconciliationRead', 'Đối soát COD', 'Xem đối soát tiền COD', 'Cho phép kế toán/thu ngân đọc collection, bàn giao, tiền thực nhận và chênh lệch COD.'],
  ['coreCodReconciliationAccept', 'Đối soát COD', 'Xác nhận tiền COD công ty nhận', 'Cho phép kế toán/thu ngân xác nhận số tiền thực nhận và trạng thái đối soát COD.'],
  ['coreCodAdjustmentCreate', 'Đối soát COD', 'Đảo hoặc điều chỉnh COD', 'Cho phép tạo reversal/adjustment append-only cho collection, bàn giao hoặc xác nhận COD.'],
].map(([key, module, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key], module, label, description, isSystem: true,
})));

export const PERMISSION_CATALOG = Object.freeze([
  ...BASE_PERMISSION_CATALOG,
  ...LOGISTICS_PERMISSION_CATALOG,
  ...ACCOUNTING_PERMISSION_CATALOG,
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
