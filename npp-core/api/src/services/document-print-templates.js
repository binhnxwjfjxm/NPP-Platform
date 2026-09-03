import * as repository from '../db/repositories/document-print-templates.js';

const PAGE_SIZES = new Set(['A4', 'A5']);
const FIELD_KEY_PATTERN = /^[a-z0-9._-]{1,64}$/;

function template(documentType, templateCode, name, pageSize, fields) {
  return Object.freeze({
    documentType,
    templateCode,
    name,
    pageSize,
    fields: Object.freeze(fields.map(([key, label, selected = true, required = false]) => Object.freeze({ key, label, defaultSelected: selected, required }))),
  });
}

const CATALOG = Object.freeze([
  template('SALES_ORDER', 'standard', 'Đơn bán hàng', 'A4', [
    ['customer', 'Khách hàng'], ['customer_code', 'Mã khách'], ['phone', 'Điện thoại'], ['document_date', 'Ngày đơn'], ['address', 'Địa chỉ'], ['warehouse', 'Kho'], ['delivery_method', 'Hình thức giao nhận'], ['collection_policy', 'Thanh toán'], ['requested_delivery_date', 'Ngày giao dự kiến'], ['line_no', 'STT hàng hóa'], ['line_item', 'Tên sản phẩm', true, true], ['line_sku', 'SKU', false], ['line_quantity', 'Số lượng', true, true], ['line_unit', 'Đơn vị tính', true, true], ['line_unit_price', 'Đơn giá', true, true], ['line_discount', 'Chiết khấu'], ['line_tax', 'Thuế'], ['line_total', 'Thành tiền', true, true], ['total_subtotal', 'Tạm tính'], ['total_discount', 'Tổng chiết khấu'], ['total_tax', 'Tổng thuế'], ['total_weight', 'Tổng khối lượng'], ['total_total', 'Tổng cộng'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('PURCHASE_ORDER', 'standard', 'Đơn mua hàng', 'A4', [
    ['status', 'Tình trạng đơn'], ['supplier', 'Nhà cung cấp'], ['warehouse', 'Kho nhận'], ['ordered_date', 'Ngày đặt'], ['expected_date', 'Dự kiến nhận'], ['supplier_reference', 'Tham chiếu nhà cung cấp'], ['currency', 'Tiền tệ'], ['line_no', 'STT hàng hóa'], ['line_item', 'Hàng hóa / SKU'], ['line_quantity', 'Số lượng'], ['line_unit', 'Đơn vị tính'], ['line_unit_price', 'Đơn giá'], ['line_discount', 'Chiết khấu'], ['line_tax', 'Thuế'], ['line_total', 'Thành tiền'], ['total_subtotal', 'Tiền hàng'], ['total_discount', 'Tổng chiết khấu'], ['total_tax', 'Tổng thuế'], ['total_total', 'Tổng cộng'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('GOODS_RECEIPT', 'standard', 'Phiếu nhận hàng', 'A4', [
    ['status', 'Tình trạng phiếu'], ['supplier', 'Nhà cung cấp'], ['purchase_order', 'Đơn mua hàng'], ['warehouse', 'Kho nhận'], ['receipt_date', 'Ngày nhận'], ['delivery_reference', 'Tham chiếu giao'], ['line_count', 'Số dòng'], ['line_no', 'STT hàng hóa'], ['line_item', 'Hàng hóa / SKU'], ['line_received', 'Thực nhận'], ['line_accepted', 'Chấp nhận'], ['line_rejected', 'Loại'], ['line_unit', 'Đơn vị tính'], ['line_lot', 'Lô / hạn sử dụng'], ['total_received', 'Tổng thực nhận'], ['total_accepted', 'Tổng chấp nhận'], ['total_rejected', 'Tổng loại'], ['total_shortage', 'Chốt thiếu'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('CUSTOMER_PAYMENT', 'standard', 'Phiếu thu', 'A5', [
    ['status', 'Tình trạng phiếu'], ['customer', 'Khách hàng'], ['receiving_unit', 'Đơn vị nhận tiền'], ['payment_date', 'Ngày thu'], ['payment_method', 'Hình thức nhận tiền'], ['bank_reference', 'Mã giao dịch ngân hàng'], ['remitting_employee', 'Nhân viên nộp tiền'], ['recorded_by', 'Người ghi nhận'], ['total_received', 'Số tiền đã nhận'], ['total_allocated', 'Đã ghi vào đơn'], ['total_unallocated', 'Chưa gắn với đơn'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('DELIVERY_ORDER', 'standard', 'Phiếu giao hàng', 'A4', [
    ['status', 'Tình trạng phiếu'], ['sales_order', 'Đơn bán hàng'], ['customer', 'Khách hàng'], ['warehouse', 'Kho xuất'], ['handover_mode', 'Hình thức giao nhận'], ['requested_delivery_date', 'Ngày giao dự kiến'], ['collection_policy', 'Chính sách thu'], ['destination', 'Địa chỉ giao'], ['line_no', 'STT hàng hóa'], ['line_item', 'Hàng hóa / SKU'], ['line_quantity', 'Số lượng'], ['line_unit', 'Đơn vị tính'], ['line_lot', 'Lô / hạn sử dụng'], ['line_location', 'Vị trí'], ['total_quantity', 'Tổng số lượng giao'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('DELIVERY_ORDER', 'packing-list', 'Phiếu đóng gói', 'A4', [
    ['status', 'Tình trạng phiếu'], ['sales_order', 'Đơn bán hàng'], ['customer', 'Khách hàng'], ['warehouse', 'Kho xuất'], ['requested_delivery_date', 'Ngày giao dự kiến'], ['destination', 'Địa chỉ giao'], ['line_no', 'STT hàng hóa'], ['line_item', 'Hàng hóa / SKU'], ['line_quantity', 'Số lượng'], ['line_unit', 'Đơn vị tính'], ['line_lot', 'Lô / hạn sử dụng'], ['line_location', 'Vị trí'], ['total_quantity', 'Tổng số lượng đóng gói'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('INVENTORY_TRANSFER', 'standard', 'Phiếu chuyển kho', 'A4', [
    ['status', 'Tình trạng phiếu'], ['source_warehouse', 'Kho xuất'], ['destination_warehouse', 'Kho nhận'], ['transfer_date', 'Ngày chuyển'], ['approved_date', 'Ngày duyệt'], ['dispatched_date', 'Ngày xuất'], ['line_count', 'Số dòng'], ['line_no', 'STT hàng hóa'], ['line_item', 'Hàng hóa / SKU'], ['line_location', 'Vị trí / lô'], ['line_quantity', 'Số lượng'], ['line_unit', 'Đơn vị tính'], ['line_base_quantity', 'Số lượng cơ sở'], ['total_base_quantity', 'Tổng số lượng cơ sở'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('STOCKTAKE', 'standard', 'Phiếu kiểm kê', 'A4', [
    ['status', 'Tình trạng phiếu'], ['warehouse', 'Kho'], ['round', 'Vòng đếm'], ['line_count', 'Số dòng'], ['created_date', 'Ngày tạo'], ['approved_date', 'Ngày duyệt'], ['posted_date', 'Ngày ghi sổ'], ['line_no', 'STT hàng hóa'], ['line_sku', 'SKU'], ['line_location', 'Vị trí / lô'], ['line_expected', 'Theo sổ'], ['line_counted', 'Thực đếm'], ['line_delta', 'Chênh lệch'], ['line_unit', 'Đơn vị tính'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('DELIVERY_TRIP', 'standard', 'Phiếu chuyến giao hàng', 'A4', [
    ['status', 'Tình trạng chuyến'], ['warehouse', 'Kho xuất phát'], ['vehicle', 'Xe'], ['driver', 'Tài xế'], ['planned_start', 'Dự kiến'], ['dispatched_at', 'Xuất phát'], ['handover_receiver', 'Người nhận bàn giao'], ['line_stop', 'Điểm giao'], ['line_delivery_order', 'Phiếu giao'], ['line_customer', 'Khách hàng'], ['total_stops', 'Số điểm giao'], ['total_delivery_orders', 'Số phiếu bàn giao'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
  template('TRIP_RECONCILIATION', 'standard', 'Biên bản đối soát chuyến', 'A4', [
    ['status', 'Tình trạng đối soát'], ['warehouse', 'Kho'], ['vehicle', 'Xe'], ['driver', 'Tài xế'], ['receipt_count', 'Số lần nhập hàng về'], ['closed_at', 'Thời điểm đóng'], ['can_close', 'Điều kiện đóng'], ['line_stop', 'Điểm giao'], ['line_delivery_order', 'Phiếu giao'], ['line_customer', 'Khách hàng'], ['line_item', 'SKU / hàng hóa'], ['line_result', 'Kết quả'], ['line_issued', 'Xuất'], ['line_delivered', 'Đã giao'], ['line_returned', 'Đã về'], ['line_outstanding', 'Còn trên xe'], ['note', 'Ghi chú'], ['signatures', 'Ký xác nhận'],
  ]),
]);

const CATALOG_BY_KEY = new Map(CATALOG.map((item) => [`${item.documentType}:${item.templateCode}`, item]));
function failure(code, message) { return Object.freeze({ ok: false, code, message, retryable: false }); }
function lookup(documentType, templateCode) { return CATALOG_BY_KEY.get(`${String(documentType ?? '').trim().toUpperCase()}:${String(templateCode ?? '').trim().toLowerCase()}`) ?? null; }
function cleanOptionalText(value, maxLength) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= maxLength ? text : undefined;
}

function selectVisibleFields(catalog, keys) {
  const selected = new Set(keys);
  return catalog.fields.filter((field) => field.required || selected.has(field.key)).map((field) => field.key);
}

function present(catalog, setting) {
  const allowed = new Set(catalog.fields.map((field) => field.key));
  const configured = Array.isArray(setting?.visible_field_keys)
    ? setting.visible_field_keys.filter((key) => allowed.has(key))
    : catalog.fields.filter((field) => field.defaultSelected).map((field) => field.key);
  const selected = selectVisibleFields(catalog, configured);
  return Object.freeze({
    documentType: catalog.documentType,
    templateCode: catalog.templateCode,
    name: catalog.name,
    pageSize: setting?.page_size ?? catalog.pageSize,
    visibleFieldKeys: selected,
    fields: catalog.fields,
    heading: setting?.heading ?? null,
    title: setting?.title ?? catalog.name,
    subtitle: setting?.subtitle ?? null,
    isCustomized: Boolean(setting),
    updatedAt: setting?.updated_at ?? null,
  });
}

function normalizePayload(catalog, payload) {
  const expectedUpdatedAt = payload?.expectedUpdatedAt === null || payload?.expectedUpdatedAt === undefined ? null : new Date(String(payload.expectedUpdatedAt));
  if (expectedUpdatedAt !== null && Number.isNaN(expectedUpdatedAt.getTime())) return failure('INVALID_TEMPLATE_VERSION', 'Phiên bản cấu hình mẫu in không hợp lệ');
  if (payload?.resetToDefault === true) return Object.freeze({ expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null, resetToDefault: true });
  const pageSize = String(payload?.pageSize ?? '').trim().toUpperCase();
  if (!PAGE_SIZES.has(pageSize)) return failure('INVALID_PAGE_SIZE', 'Khổ giấy chỉ có thể là A4 hoặc A5');
  if (!Array.isArray(payload?.visibleFieldKeys)) return failure('INVALID_PRINT_FIELDS', 'Danh sách mục in không hợp lệ');
  const allowed = new Set(catalog.fields.map((field) => field.key));
  const requestedFieldKeys = [...new Set(payload.visibleFieldKeys.map((value) => String(value ?? '').trim()))];
  if (!requestedFieldKeys.length || requestedFieldKeys.some((key) => !FIELD_KEY_PATTERN.test(key) || !allowed.has(key))) return failure('INVALID_PRINT_FIELDS', 'Mẫu in phải có ít nhất một mục hợp lệ');
  const visibleFieldKeys = selectVisibleFields(catalog, requestedFieldKeys);
  const heading = cleanOptionalText(payload?.heading, 160);
  const title = cleanOptionalText(payload?.title, 160);
  const subtitle = cleanOptionalText(payload?.subtitle, 240);
  if (heading === undefined) return failure('INVALID_PRINT_HEADING', 'Tiêu đề đầu phiếu không được vượt quá 160 ký tự');
  if (title === undefined) return failure('INVALID_PRINT_TITLE', 'Tên chứng từ không được vượt quá 160 ký tự');
  if (subtitle === undefined) return failure('INVALID_PRINT_SUBTITLE', 'Dòng phụ không được vượt quá 240 ký tự');
  return Object.freeze({ pageSize, visibleFieldKeys, heading, title, subtitle, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null, resetToDefault: false });
}

export function listDocumentPrintTemplates(client, { installationId }) {
  return repository.listDocumentPrintTemplateSettings(client, { installationId }).then((settings) => {
    const byKey = new Map(settings.map((setting) => [`${setting.document_type}:${setting.template_code}`, setting]));
    return Object.freeze({ ok: true, templates: CATALOG.map((item) => present(item, byKey.get(`${item.documentType}:${item.templateCode}`))) });
  });
}

export async function updateDocumentPrintTemplate(client, { installationId, documentType, templateCode, payload, actorId }) {
  const catalog = lookup(documentType, templateCode);
  if (!catalog) return failure('PRINT_TEMPLATE_NOT_FOUND', 'Mẫu in không tồn tại');
  const normalized = normalizePayload(catalog, payload);
  if ('code' in normalized) return normalized;
  const before = await repository.getDocumentPrintTemplateSetting(client, { installationId, documentType: catalog.documentType, templateCode: catalog.templateCode, forUpdate: true });
  if (before && normalized.expectedUpdatedAt !== before.updated_at.toISOString()) return failure('CONFLICT', 'Mẫu in đã được thay đổi. Hãy tải lại trước khi lưu');
  if (!before && normalized.expectedUpdatedAt !== null) return failure('CONFLICT', 'Mẫu in đã được thay đổi. Hãy tải lại trước khi lưu');
  if (normalized.resetToDefault) {
    if (before) {
      const removed = await repository.deleteDocumentPrintTemplateSetting(client, { installationId, documentType: catalog.documentType, templateCode: catalog.templateCode, expectedUpdatedAt: before.updated_at });
      if (!removed) return failure('CONFLICT', 'Mẫu in đã được thay đổi. Hãy tải lại trước khi lưu');
    }
    return Object.freeze({ ok: true, template: present(catalog, null), beforeData: before ? present(catalog, before) : null, reset: true });
  }
  const data = {
    installationId,
    documentType: catalog.documentType,
    templateCode: catalog.templateCode,
    pageSize: normalized.pageSize,
    visibleFieldKeys: normalized.visibleFieldKeys,
    heading: normalized.heading,
    title: normalized.title,
    subtitle: normalized.subtitle,
    actorId,
  };
  const stored = before
    ? await repository.updateDocumentPrintTemplateSetting(client, { ...data, expectedUpdatedAt: before.updated_at })
    : await repository.insertDocumentPrintTemplateSetting(client, data);
  if (!stored) return failure('CONFLICT', 'Mẫu in đã được thay đổi. Hãy tải lại trước khi lưu');
  return Object.freeze({ ok: true, template: present(catalog, stored), beforeData: before ? present(catalog, before) : null, reset: false });
}

export { CATALOG as DOCUMENT_PRINT_TEMPLATE_CATALOG };
export const documentPrintTemplateInternals = Object.freeze({ lookup, present, normalizePayload });
