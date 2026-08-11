
export type Tab = 'products' | 'pricing' | 'stocktake' | 'quotation' | 'movements';
export type ImportKind = 'products' | 'pricing' | 'stocktake';
export type Product = {
  id: string; code: string; name: string; catalog_name: string | null; category_id: string | null; brand_id: string | null;
  category_code: string | null; category_name: string | null; brand_code: string | null; brand_name: string | null;
  description: string | null; notes: string | null; is_catalog_visible: boolean; is_orderable: boolean; is_active: boolean;
};
export type Variant = {
  id: string; product_id: string; sku: string; name: string; variant_kind: 'BASE' | 'CARTON' | 'OTHER';
  is_inventory_base: boolean; is_sellable: boolean; is_catalog_visible: boolean; is_active: boolean;
};
export type Category = { id: string; code: string; name: string; is_active: boolean };
export type Brand = { id: string; code: string; name: string; is_active: boolean };
export type Unit = { id: string; code: string; name: string; is_active: boolean };
export type PriceList = {
  id: string; code: string; name: string; list_type: string; currency_code: string; channel_id: string | null;
  customer_group_id: string | null; customer_id: string | null; is_active: boolean;
};
export type PriceItem = {
  id: string; price_list_id: string; sku: string; adjustment_type: string; amount_minor: string | null; rate_bps: number | null;
  min_quantity: string; max_quantity: string | null; effective_from: string | null; effective_to: string | null;
  source_key: string | null; external_rule_code: string | null; note: string | null; is_active: boolean; updated_at: string;
};
export type Channel = { id: string; code: string; name: string; is_active: boolean };
export type CustomerGroup = { id: string; code: string; name: string; is_active: boolean };
export type Customer = { id: string; code: string; name: string; group_id: string | null; is_active: boolean };
export type Balance = {
  warehouse_id: string; warehouse_code: string; warehouse_name: string; location_id: string | null; location_code: string | null;
  location_name: string | null; base_variant_id: string; base_sku: string; base_variant_name: string | null; lot_id: string | null;
  lot_code: string | null; on_hand_quantity: string; reserved_quantity: string; available_quantity: string;
};
export type Stocktake = { id: string; stocktakeNumber: string; revision: string; status: string };
export type Movement = {
  movement_id: string; movement_type: string; source_document_type: string | null; source_document_number: string | null;
  document_number: string | null; document_date: string; posted_at: string; posted_by: string; direction: 'IN' | 'OUT';
  base_quantity_delta: string; base_sku: string; lot_code: string | null; source_line_reference: string | null;
};
export type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string; retryable?: boolean } };
export type RowMap = Record<string, string>;
export type PendingImport = { kind: ImportKind; fileName: string; rows: RowMap[] };
export type OfficialRows = { jobId?: string | null; columns: string[]; rows: Array<Record<string, unknown>> };
export type QuotationRow = { sku: string; name: string; product: string; quantity: string; finalPrice: string; lineTotal: string; priceListCode: string; currency: string; error: string };
export type MovementView = Movement & { stockAfter: string };

export const PRODUCT_COLUMNS = [
  'productCode', 'productName', 'catalogName', 'categoryCode', 'brandCode', 'description', 'notes',
  'productIsCatalogVisible', 'productIsOrderable', 'productIsActive', 'sku', 'skuName', 'variantKind',
  'isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive',
  'unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired',
] as const;
export const PRODUCT_REQUIRED_COLUMNS = [
  'productCode', 'productName', 'productIsCatalogVisible', 'productIsOrderable', 'productIsActive',
  'sku', 'skuName', 'variantKind', 'isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive',
  'unitCode', 'conversionToBase', 'lotTrackingMode', 'expiryTrackingMode', 'locationRequired',
] as const;
export const PRICING_COLUMNS = [
  'priceListCode', 'priceListName', 'listType', 'currencyCode', 'sku', 'sourceKey', 'adjustmentType',
  'amountMinor', 'rateBps', 'minQuantity', 'maxQuantity', 'effectiveFrom', 'effectiveTo', 'externalRuleCode', 'note', 'isActive',
] as const;
export const STOCKTAKE_COLUMNS = ['warehouseCode', 'locationCode', 'sku', 'lotCode', 'actualCount'] as const;
export const QUOTATION_COLUMNS = ['sku', 'productName', 'skuName', 'quantity', 'currencyCode', 'unitPriceMinor', 'lineTotalMinor', 'priceListCode'] as const;

export const COLUMN_LABELS: Record<string, string> = {
  productCode: 'Mã sản phẩm', productName: 'Tên sản phẩm', catalogName: 'Tên hiển thị bán hàng', categoryCode: 'Mã loại sản phẩm', brandCode: 'Mã nhãn hàng',
  description: 'Mô tả', notes: 'Ghi chú', productIsCatalogVisible: 'Hiển thị sản phẩm khi bán hàng', productIsOrderable: 'Cho phép đặt hàng', productIsActive: 'Sản phẩm đang sử dụng',
  sku: 'SKU', skuName: 'Tên SKU / quy cách', variantKind: 'Loại SKU', isInventoryBase: 'SKU dùng làm đơn vị tồn chuẩn', isSellable: 'Cho phép bán SKU',
  isCatalogVisible: 'Hiển thị SKU khi bán hàng', isActive: 'SKU đang sử dụng', unitCode: 'Đơn vị tính', conversionToBase: 'Hệ số quy đổi về đơn vị tồn chuẩn',
  lotTrackingMode: 'Quản lý theo lô', expiryTrackingMode: 'Quản lý hạn sử dụng', locationRequired: 'Bắt buộc chọn vị trí kho',
  priceListCode: 'Mã bảng giá', priceListName: 'Tên bảng giá', listType: 'Loại bảng giá', currencyCode: 'Tiền tệ', sourceKey: 'Mã nguồn dòng giá',
  adjustmentType: 'Cách tính giá', amountMinor: 'Số tiền', rateBps: 'Tỷ lệ', minQuantity: 'Số lượng từ', maxQuantity: 'Số lượng đến', effectiveFrom: 'Hiệu lực từ',
  effectiveTo: 'Hiệu lực đến', externalRuleCode: 'Mã quy tắc ngoài', note: 'Ghi chú', warehouseCode: 'Mã kho', locationCode: 'Mã vị trí', lotCode: 'Mã lô',
  actualCount: 'Số đếm thực tế', quantity: 'Số lượng', unitPriceMinor: 'Đơn giá', lineTotalMinor: 'Thành tiền',
};
export const LABEL_TO_COLUMN = new Map(Object.entries(COLUMN_LABELS).map(([key, label]) => [label.trim().toLocaleLowerCase('vi-VN'), key]));
export const TABS: Tab[] = ['products', 'pricing', 'stocktake', 'quotation', 'movements'];
export const BOOLEAN_FIELDS = new Set(['productIsCatalogVisible', 'productIsOrderable', 'productIsActive', 'isInventoryBase', 'isSellable', 'isCatalogVisible', 'isActive', 'locationRequired']);
export const LIST_TYPE_LABELS: Record<string, string> = { BASE: 'Giá nền', CHANNEL: 'Theo kênh', CUSTOMER_GROUP: 'Theo nhóm khách', CUSTOMER: 'Theo khách hàng', PROMOTION: 'Khuyến mãi', CUSTOM: 'Quy tắc khác' };
export const ADJUSTMENT_LABELS: Record<string, string> = { FIXED_PRICE: 'Giá cố định', PERCENT_DISCOUNT: 'Giảm phần trăm', AMOUNT_DISCOUNT: 'Giảm số tiền', PERCENT_MARKUP: 'Tăng phần trăm', AMOUNT_MARKUP: 'Tăng số tiền' };

export function labelFor(column: string) { return COLUMN_LABELS[column] ?? column; }
export function displayCell(column: string, value: unknown) {
  if (value === true || (typeof value === 'string' && value.toLowerCase() === 'true')) return 'Có';
  if (value === false || (typeof value === 'string' && value.toLowerCase() === 'false')) return 'Không';
  const text = String(value ?? ''); const upper = text.trim().toUpperCase();
  if (column === 'variantKind') return ({ BASE: 'Đơn vị lẻ', CARTON: 'Thùng', OTHER: 'Quy cách khác' } as Record<string, string>)[upper] ?? text;
  if (column === 'lotTrackingMode') return upper === 'REQUIRED' ? 'Có' : upper === 'NONE' ? 'Không' : text;
  if (column === 'expiryTrackingMode') return upper === 'REQUIRED' ? 'Bắt buộc nhập' : upper === 'OPTIONAL' ? 'Có thể nhập' : upper === 'NONE' ? 'Không quản lý' : text;
  if (column === 'listType') return LIST_TYPE_LABELS[upper] ?? text;
  if (column === 'adjustmentType') return ADJUSTMENT_LABELS[upper] ?? text;
  return text;
}
export function pricingChoice(column: string, value: string) {
  const normalized = value.trim().toLocaleLowerCase('vi-VN');
  if (column === 'listType') return Object.entries(LIST_TYPE_LABELS).find(([, label]) => label.toLocaleLowerCase('vi-VN') === normalized)?.[0] ?? value.trim().toUpperCase();
  if (column === 'adjustmentType') return Object.entries(ADJUSTMENT_LABELS).find(([, label]) => label.toLocaleLowerCase('vi-VN') === normalized)?.[0] ?? value.trim().toUpperCase();
  return value;
}
export function normalizeHeader(value: string) {
  const text = value.trim();
  return LABEL_TO_COLUMN.get(text.toLocaleLowerCase('vi-VN')) ?? text;
}
export function humanizeMessage(value: string) {
  return value
    .replaceAll('unitCode', 'Đơn vị tính')
    .replaceAll('conversionToBase', 'Hệ số quy đổi')
    .replaceAll('isInventoryBase', 'SKU dùng làm đơn vị tồn chuẩn')
    .replaceAll('lotTrackingMode', 'Quản lý theo lô')
    .replaceAll('expiryTrackingMode', 'Quản lý hạn sử dụng')
    .replaceAll('locationRequired', 'Bắt buộc chọn vị trí kho')
    .replaceAll('priceListCode', 'Mã bảng giá')
    .replaceAll('sourceKey', 'Mã nguồn dòng giá')
    .replaceAll('actualCount', 'Số đếm thực tế')
    .replaceAll('productIsCatalogVisible', 'Hiển thị sản phẩm khi bán hàng')
    .replaceAll('productIsOrderable', 'Cho phép đặt hàng')
    .replaceAll('productIsActive', 'Sản phẩm đang sử dụng')
    .replaceAll('isSellable', 'Cho phép bán SKU')
    .replaceAll('isCatalogVisible', 'Hiển thị SKU khi bán hàng')
    .replaceAll('isActive', 'SKU đang sử dụng')
    .replaceAll('variantKind', 'Loại SKU')
    .replaceAll('productName', 'Tên sản phẩm')
    .replaceAll('skuName', 'Tên SKU / quy cách')
    .replaceAll('must be true or false', 'phải chọn Có hoặc Không')
    .replaceAll('TRUE/FALSE', 'Có/Không')
    .replace(/\bRow\s+(\d+)/g, 'Dòng $1')
    .replaceAll('canonical', 'chuẩn của hệ thống')
    .replaceAll('legacy', 'dữ liệu cũ')
    .replaceAll('optimistic PATCH', 'cập nhật có kiểm tra phiên bản');
}
export function bool(value: string, field: string) {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'co', 'có'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'khong', 'không'].includes(normalized)) return false;
  throw new Error(`${labelFor(field)} phải chọn Có hoặc Không.`);
}
export function boolChoice(value: string) {
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'co', 'có'].includes(normalized)) return 'CÓ';
  if (['false', '0', 'no', 'n', 'khong', 'không'].includes(normalized)) return 'KHÔNG';
  return '';
}
export function variantChoice(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === 'BASE' || normalized === 'ĐƠN VỊ LẺ' || normalized === 'DON VI LE') return 'BASE';
  if (normalized === 'CARTON' || normalized === 'THÙNG' || normalized === 'THUNG') return 'CARTON';
  if (normalized === 'OTHER' || normalized === 'QUY CÁCH KHÁC' || normalized === 'QUY CACH KHAC') return 'OTHER';
  return normalized;
}
export function lotChoice(value: string) {
  const normalized = value.trim().toUpperCase();
  if (['REQUIRED', 'CO', 'CÓ', 'THEO LO', 'THEO LÔ'].includes(normalized)) return 'CÓ';
  if (['NONE', 'KHONG', 'KHÔNG', 'KHONG THEO LO', 'KHÔNG THEO LÔ'].includes(normalized)) return 'KHÔNG';
  return '';
}
export function expiryChoice(value: string) {
  const normalized = value.trim().toUpperCase();
  if (['REQUIRED', 'BAT BUOC', 'BẮT BUỘC'].includes(normalized)) return 'BẮT BUỘC';
  if (['OPTIONAL', 'TUY CHON', 'TÙY CHỌN', 'CO THE NHAP', 'CÓ THỂ NHẬP'].includes(normalized)) return 'TÙY CHỌN';
  if (['NONE', 'KHONG', 'KHÔNG'].includes(normalized)) return 'KHÔNG';
  return '';
}
export function normalizeProductChoices(rows: RowMap[]) {
  return rows.map((row) => {
    const next = { ...row };
    for (const field of BOOLEAN_FIELDS) if (field in next) next[field] = boolChoice(next[field]);
    next.variantKind = variantChoice(next.variantKind ?? '');
    next.lotTrackingMode = lotChoice(next.lotTrackingMode ?? '');
    next.expiryTrackingMode = expiryChoice(next.expiryTrackingMode ?? '');
    return next;
  });
}
