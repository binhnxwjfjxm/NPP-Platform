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
  coreFulfillmentRead: 'core.fulfillment.read',
  coreFulfillmentConfigureBackorder: 'core.fulfillment.configure-backorder',
  coreFulfillmentAllocate: 'core.fulfillment.allocate',
  coreFulfillmentPick: 'core.fulfillment.pick',
  coreFulfillmentPack: 'core.fulfillment.pack',
  coreFulfillmentOverrideAllocationPolicy: 'core.fulfillment.override-allocation-policy',
  coreDeliveryOrderRead: 'core.delivery-order.read',
  coreDeliveryOrderCreate: 'core.delivery-order.create',
  coreDeliveryOrderConfirm: 'core.delivery-order.confirm',
  coreDeliveryOrderCancel: 'core.delivery-order.cancel',
  coreDeliveryOrderIssueInventory: 'core.delivery-order.issue-inventory',
  coreDeliveryOrderPickupHandover: 'core.delivery-order.pickup-handover',
  coreDeliveryOrderManualHandover: 'core.delivery-order.manual-handover',
  coreDeliveryOrderReverseInventoryIssue: 'core.delivery-order.reverse-inventory-issue',
  coreCustomerReturnRead: 'core.customer-return.read',
  coreCustomerReturnCreate: 'core.customer-return.create',
  coreCustomerReturnReceive: 'core.customer-return.receive',
  coreCustomerReturnCancel: 'core.customer-return.cancel',
  coreCustomerOnboardingRead: 'core.customer-onboarding.read',
  coreCustomerOnboardingSubmit: 'core.customer-onboarding.submit',
  coreCustomerOnboardingReview: 'core.customer-onboarding.review',
  coreCustomerOnboardingApprove: 'core.customer-onboarding.approve',
  coreCustomerOnboardingLinkExisting: 'core.customer-onboarding.link-existing',
  coreCustomerOnboardingReject: 'core.customer-onboarding.reject',
  coreReportingSalesRead: 'core.reporting.sales.read',
  coreReportingPurchasingRead: 'core.reporting.purchasing.read',
});

const SALES_ORDER_PERMISSION_CATALOG = Object.freeze([
  ['coreSalesOrderRead', 'Bán hàng', 'Xem đơn bán hàng', 'Cho phép đọc danh sách, chi tiết và lịch sử phiên bản đơn bán hàng trong phạm vi kho được cấp.'],
  ['coreSalesOrderCreate', 'Bán hàng', 'Tạo đơn bán hàng', 'Cho phép tạo đơn bán hàng ở trạng thái nháp.'],
  ['coreSalesOrderUpdateDraft', 'Bán hàng', 'Sửa đơn bán hàng nháp', 'Cho phép cập nhật phiên bản nháp của đơn bán hàng.'],
  ['coreSalesOrderConfirm', 'Bán hàng', 'Xác nhận đơn bán hàng', 'Cho phép xác nhận đơn bán hàng và cấp số chứng từ.'],
  ['coreSalesOrderAmend', 'Bán hàng', 'Điều chỉnh đơn bán hàng', 'Cho phép tạo và xác nhận phiên bản điều chỉnh bất biến.'],
  ['coreSalesOrderCancel', 'Bán hàng', 'Hủy đơn bán hàng', 'Cho phép hủy đơn bán hàng theo chính sách trạng thái.'],
  ['coreSalesOrderPriceOverride', 'Bán hàng', 'Sửa giá bán trên đơn', 'Cho phép sửa trực tiếp đơn giá trên dòng hàng; hệ thống tự lưu lịch sử thay đổi.'],
  ['coreSalesOrderDiscountOverride', 'Bán hàng', 'Sửa chiết khấu bán hàng', 'Cho phép nhập chiết khấu theo từng dòng hoặc chiết khấu bổ sung toàn đơn theo đúng chính sách.'],
  ['coreSalesOrderCreditOverride', 'Bán hàng', 'Duyệt ngoại lệ bán chịu', 'Cho phép duyệt ngoại lệ chính sách tín dụng có lý do và audit.'],
  ['coreFulfillmentRead', 'Bán hàng', 'Xem tình trạng giữ hàng', 'Cho phép xem số lượng đã giữ, còn thiếu và tiến độ thực hiện của đơn bán hàng trong phạm vi kho được cấp.'],
  ['coreFulfillmentConfigureBackorder', 'Bán hàng', 'Cấu hình cho phép thiếu hàng', 'Cho phép thay đổi chính sách cho xác nhận đơn khi tồn khả dụng không đủ.'],
  ['coreFulfillmentAllocate', 'Kho', 'Phân bổ hàng cho đơn', 'Cho phép phân bổ phần hàng đã giữ của đơn bán hàng vào đúng vị trí và lô trong phạm vi kho được cấp.'],
  ['coreFulfillmentPick', 'Kho', 'Xác nhận soạn hàng', 'Cho phép xác nhận số lượng thực tế đã lấy từ allocation của đơn bán hàng.'],
  ['coreFulfillmentPack', 'Kho', 'Xác nhận đóng gói', 'Cho phép xác nhận số lượng đã đóng gói từ phần đã soạn.'],
  ['coreFulfillmentOverrideAllocationPolicy', 'Kho', 'Đổi thứ tự lô được đề xuất', 'Cho phép phân bổ thủ công khác FEFO/FIFO khi có lý do bắt buộc.'],
  ['coreDeliveryOrderRead', 'Giao nhận', 'Xem chứng từ giao nhận', 'Cho phép đọc phần hàng đã đóng gói và Delivery Order trong phạm vi kho được cấp.'],
  ['coreDeliveryOrderCreate', 'Giao nhận', 'Tạo chứng từ giao nhận', 'Cho phép tạo Delivery Order từ phần hàng đã đóng gói trong phạm vi kho được cấp.'],
  ['coreDeliveryOrderConfirm', 'Giao nhận', 'Xác nhận sẵn sàng bàn giao', 'Cho phép xác nhận Delivery Order sẵn sàng chuyển sang vận hành giao nhận.'],
  ['coreDeliveryOrderCancel', 'Giao nhận', 'Hủy chứng từ giao nhận nháp', 'Cho phép hủy Delivery Order nháp với lý do bắt buộc và trả phần packed về hàng đợi.'],
  ['coreDeliveryOrderIssueInventory', 'Giao nhận', 'Xuất kho theo điều phối giao hàng', 'Cho phép service điều phối được cấp quyền ghi Inventory OUT từ Delivery Order đã sẵn sàng.'],
  ['coreDeliveryOrderPickupHandover', 'Giao nhận', 'Xác nhận bàn giao tại quầy', 'Cho phép xác nhận bàn giao vật lý cho khách nhận tại quầy và ghi Inventory OUT.'],
  ['coreDeliveryOrderManualHandover', 'Giao nhận', 'Xác nhận giao thủ công', 'Cho phép NPP Operations xác nhận giao trực tiếp Delivery Order giao tận nơi, ghi Inventory OUT và công nợ theo lượng thực giao.'],
  ['coreDeliveryOrderReverseInventoryIssue', 'Giao nhận', 'Đảo xuất kho giao nhận', 'Cho phép đảo một lần movement xuất kho sai khi chưa có dữ liệu downstream chặn.'],
  ['coreCustomerReturnRead', 'Hàng khách trả', 'Xem hàng khách trả', 'Cho phép đọc nguồn hàng đã xuất và phiếu hàng khách trả trong phạm vi kho.'],
  ['coreCustomerReturnCreate', 'Hàng khách trả', 'Tạo phiếu hàng khách trả', 'Cho phép tạo phiếu nháp từ dòng Delivery Order đã xuất có nguồn gốc bất biến.'],
  ['coreCustomerReturnReceive', 'Hàng khách trả', 'Nhận hàng khách trả vào kho', 'Cho phép xác nhận số lượng thực nhận và ghi Inventory IN.'],
  ['coreCustomerReturnCancel', 'Hàng khách trả', 'Hủy phiếu hàng khách trả nháp', 'Cho phép hủy phiếu nháp với lý do bắt buộc.'],
].map(([key, module, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key],
  module,
  label,
  description,
  isSystem: true,
})));

const CUSTOMER_ONBOARDING_PERMISSION_CATALOG = Object.freeze([
  ['coreCustomerOnboardingRead', 'Xem đề nghị xác minh khách hàng', 'Cho phép đọc đề nghị xác minh/mở mã khách hàng trong phạm vi được cấp.'],
  ['coreCustomerOnboardingSubmit', 'Gửi đề nghị xác minh khách hàng', 'Cho phép gửi đề nghị xác minh từ một nhu cầu mua hoặc order intent cần lập đơn chính thức.'],
  ['coreCustomerOnboardingReview', 'Rà soát đề nghị xác minh khách hàng', 'Cho phép nhận xử lý, yêu cầu bổ sung và hủy đề nghị xác minh khách hàng.'],
  ['coreCustomerOnboardingApprove', 'Duyệt mở mã khách hàng', 'Cho phép duyệt và tạo đúng một khách hàng cùng địa chỉ chính thức.'],
  ['coreCustomerOnboardingLinkExisting', 'Liên kết khách hàng hiện hữu', 'Cho phép liên kết đề nghị với khách hàng và địa chỉ đang hoạt động.'],
  ['coreCustomerOnboardingReject', 'Từ chối đề nghị xác minh khách hàng', 'Cho phép từ chối đề nghị với lý do bắt buộc.'],
].map(([key, label, description]) => Object.freeze({
  permissionKey: PERMISSIONS[key],
  module: 'Xác minh khách hàng',
  label,
  description,
  isSystem: true,
})));

const REPORTING_PERMISSION_CATALOG = Object.freeze([
  Object.freeze({
    permissionKey: PERMISSIONS.coreReportingSalesRead,
    module: 'Báo cáo bán hàng',
    label: 'Xem báo cáo bán hàng',
    description: 'Cho phép đọc dashboard bán hàng trong đúng installation và phạm vi kho được cấp.',
    isSystem: true,
  }),
  Object.freeze({
    permissionKey: PERMISSIONS.coreReportingPurchasingRead,
    module: 'Báo cáo mua hàng',
    label: 'Xem báo cáo mua hàng',
    description: 'Cho phép đọc dashboard mua hàng trong đúng installation và phạm vi kho được cấp.',
    isSystem: true,
  }),
]);

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
  ...CUSTOMER_ONBOARDING_PERMISSION_CATALOG,
  ...REPORTING_PERMISSION_CATALOG,
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
