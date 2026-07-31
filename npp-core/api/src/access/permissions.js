import {
  PERMISSIONS as CORE_PERMISSIONS,
  PERMISSION_CATALOG as CORE_PERMISSION_CATALOG,
} from './permissions-core.js';

export const PERMISSIONS = Object.freeze({
  ...CORE_PERMISSIONS,
  coreSupplierPurchasePriceRead: 'core.supplier-purchase-price.read',
  coreSupplierPurchasePriceManage: 'core.supplier-purchase-price.manage',
  corePurchaseOrderPriceRead: 'core.purchase-order.price.read',
  corePurchaseOrderPriceOverride: 'core.purchase-order.price.override',
  corePayableRead: 'core.payable.read',
  coreSupplierPaymentRead: 'core.supplier-payment.read',
  coreSupplierPaymentCreate: 'core.supplier-payment.create',
  coreSupplierPaymentReverse: 'core.supplier-payment.reverse',
  corePayableAllocationCreate: 'core.payable-allocation.create',
  corePayableAllocationReverse: 'core.payable-allocation.reverse',
  coreSalesOrderRead: 'core.sales-order.read',
  coreSalesOrderCreate: 'core.sales-order.create',
  coreSalesOrderUpdateDraft: 'core.sales-order.update-draft',
  coreSalesOrderConfirm: 'core.sales-order.confirm',
  coreSalesOrderAmend: 'core.sales-order.amend',
  coreSalesOrderCancel: 'core.sales-order.cancel',
  coreSalesOrderPriceOverride: 'core.sales-order.price.override',
  coreSalesOrderDiscountOverride: 'core.sales-order.discount.override',
  coreSalesOrderCreditOverride: 'core.sales-order.credit.override',
});

const SALES_ORDER_PERMISSION_CATALOG = Object.freeze([
  ['coreSalesOrderRead', 'Xem đơn bán hàng', 'Cho phép đọc danh sách, chi tiết và lịch sử phiên bản đơn bán hàng trong phạm vi kho được cấp.'],
  ['coreSalesOrderCreate', 'Tạo đơn bán hàng', 'Cho phép tạo đơn bán hàng ở trạng thái nháp.'],
  ['coreSalesOrderUpdateDraft', 'Sửa đơn bán hàng nháp', 'Cho phép cập nhật phiên bản nháp của đơn bán hàng.'],
  ['coreSalesOrderConfirm', 'Xác nhận đơn bán hàng', 'Cho phép xác nhận đơn bán hàng và cấp số chứng từ.'],
  ['coreSalesOrderAmend', 'Điều chỉnh đơn bán hàng', 'Cho phép tạo và xác nhận phiên bản điều chỉnh bất biến.'],
  ['coreSalesOrderCancel', 'Hủy đơn bán hàng', 'Cho phép hủy đơn bán hàng theo chính sách trạng thái.'],
  ['coreSalesOrderPriceOverride', 'Ghi đè giá bán', 'Cho phép ghi đè giá bán do hệ thống phân giải khi có lý do riêng trên từng dòng.'],
  ['coreSalesOrderDiscountOverride', 'Chiết khấu bổ sung toàn đơn', 'Cho phép áp dụng chiết khấu bổ sung toàn đơn có lý do và phân bổ chính xác xuống từng dòng.'],
  ['coreSalesOrderCreditOverride', 'Duyệt ngoại lệ bán chịu', 'Cho phép duyệt ngoại lệ chính sách tín dụng có lý do và audit.'],
].map(([key, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key],
  module: 'Bán hàng',
  label,
  description,
  isSystem: true,
})));

export const PERMISSION_CATALOG = Object.freeze([
  ...CORE_PERMISSION_CATALOG,
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierPurchasePriceRead, module: 'Mua hàng', label: 'Xem bảng giá mua', description: 'Cho phép đọc và phân giải giá mua theo nhà cung cấp, SKU, đơn vị, tiền tệ và hiệu lực.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierPurchasePriceManage, module: 'Mua hàng', label: 'Quản lý bảng giá mua', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái giá mua theo nhà cung cấp.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePurchaseOrderPriceRead, module: 'Mua hàng', label: 'Xem giá đơn đặt hàng', description: 'Cho phép đọc đơn giá, chiết khấu, thuế và tổng tiền của đơn đặt hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePurchaseOrderPriceOverride, module: 'Mua hàng', label: 'Nhập tay giá đơn đặt hàng', description: 'Cho phép thay giá mua đã phân giải bằng giá nhập tay có lý do trên từng đơn đặt hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePayableRead, module: 'Công nợ phải trả', label: 'Xem công nợ phải trả', description: 'Cho phép đọc chứng từ, sổ chi tiết và số dư công nợ nhà cung cấp trong phạm vi kho được cấp.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierPaymentRead, module: 'Thanh toán nhà cung cấp', label: 'Xem thanh toán nhà cung cấp', description: 'Cho phép đọc phiếu thanh toán nhà cung cấp trong phạm vi kho được cấp.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierPaymentCreate, module: 'Thanh toán nhà cung cấp', label: 'Ghi nhận thanh toán nhà cung cấp', description: 'Cho phép ghi nhận phiếu thanh toán nhà cung cấp đã post trong phạm vi kho được cấp.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierPaymentReverse, module: 'Thanh toán nhà cung cấp', label: 'Đảo thanh toán nhà cung cấp', description: 'Cho phép đảo phiếu thanh toán nhà cung cấp chưa có phân bổ đang hiệu lực.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePayableAllocationCreate, module: 'Công nợ phải trả', label: 'Phân bổ công nợ phải trả', description: 'Cho phép phân bổ thanh toán hoặc phiếu trả nhà cung cấp vào chứng từ phải trả.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePayableAllocationReverse, module: 'Công nợ phải trả', label: 'Đảo phân bổ công nợ phải trả', description: 'Cho phép đảo một phân bổ công nợ bằng chứng từ đảo bất biến.', isSystem: true }),
  ...SALES_ORDER_PERMISSION_CATALOG,
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
