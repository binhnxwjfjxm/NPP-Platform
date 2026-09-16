import { formatExactDecimal } from './decimal-display.js';
import type { InventoryBalance, InventoryLot, InventoryTrackingPolicy } from './inventory-types';
import type { InventoryTrackingPolicyCandidate } from './inventory-policy-types';

export type InventoryExportScope = 'balances' | 'lots' | 'tracking-policies';
export type InventoryExportFormat = 'xlsx' | 'csv';

export type InventoryPolicyExportRecord = Readonly<{
  candidate: InventoryTrackingPolicyCandidate;
  policy: InventoryTrackingPolicy | null;
}>;

type ExportColumnOption = Readonly<{ key: string; label: string }>;

export const INVENTORY_EXPORT_SCOPE_LABELS: Readonly<Record<InventoryExportScope, string>> = Object.freeze({
  balances: 'Tồn kho',
  lots: 'Lô hàng',
  'tracking-policies': 'Chính sách lô',
});

export const INVENTORY_EXPORT_COLUMN_OPTIONS: Readonly<Record<InventoryExportScope, readonly ExportColumnOption[]>> = Object.freeze({
  balances: Object.freeze([
    { key: 'productCode', label: 'Mã sản phẩm' },
    { key: 'productName', label: 'Tên sản phẩm' },
    { key: 'baseSku', label: 'SKU tồn chuẩn' },
    { key: 'baseVariantName', label: 'Quy cách' },
    { key: 'warehouseCode', label: 'Mã kho' },
    { key: 'warehouseName', label: 'Kho' },
    { key: 'locationCode', label: 'Mã vị trí' },
    { key: 'locationName', label: 'Vị trí' },
    { key: 'lotCode', label: 'Lô' },
    { key: 'expiryDate', label: 'Hạn sử dụng' },
    { key: 'baseUnit', label: 'ĐVT' },
    { key: 'onHand', label: 'Tồn kho' },
    { key: 'reserved', label: 'Đã giữ cho đơn' },
    { key: 'available', label: 'Có thể xuất' },
    { key: 'packageSku', label: 'SKU quy cách lớn' },
    { key: 'packageUnit', label: 'ĐVT quy cách lớn' },
    { key: 'packageConversion', label: 'Quy đổi' },
  ]),
  lots: Object.freeze([
    { key: 'productCode', label: 'Mã sản phẩm' },
    { key: 'productName', label: 'Tên sản phẩm' },
    { key: 'baseSku', label: 'SKU tồn chuẩn' },
    { key: 'baseVariantName', label: 'Quy cách' },
    { key: 'lotCode', label: 'Mã lô' },
    { key: 'manufacturedDate', label: 'Ngày sản xuất' },
    { key: 'expiryDate', label: 'Hạn sử dụng' },
    { key: 'supplierLotReference', label: 'Tham chiếu nhà cung cấp' },
    { key: 'createdAt', label: 'Thời gian ghi nhận' },
  ]),
  'tracking-policies': Object.freeze([
    { key: 'productCode', label: 'Mã sản phẩm' },
    { key: 'productName', label: 'Tên sản phẩm' },
    { key: 'baseSku', label: 'SKU tồn chuẩn' },
    { key: 'baseVariantName', label: 'Quy cách' },
    { key: 'setupStatus', label: 'Trạng thái thiết lập' },
    { key: 'lotTrackingMode', label: 'Quản lý lô' },
    { key: 'expiryTrackingMode', label: 'Hạn sử dụng' },
    { key: 'itemStatus', label: 'Trạng thái hàng hóa' },
  ]),
});

export const INVENTORY_EXPORT_DEFAULT_COLUMNS: Readonly<Record<InventoryExportScope, readonly string[]>> = Object.freeze({
  balances: Object.freeze(['productCode', 'productName', 'baseSku', 'warehouseCode', 'warehouseName', 'locationCode', 'lotCode', 'expiryDate', 'baseUnit', 'onHand', 'reserved', 'available']),
  lots: Object.freeze(['productCode', 'productName', 'baseSku', 'lotCode', 'manufacturedDate', 'expiryDate', 'supplierLotReference']),
  'tracking-policies': Object.freeze(['productCode', 'productName', 'baseSku', 'setupStatus', 'lotTrackingMode', 'expiryTrackingMode']),
});

export function isInventoryExportScope(value: string): value is InventoryExportScope {
  return value === 'balances' || value === 'lots' || value === 'tracking-policies';
}

export function isInventoryExportColumn(scope: InventoryExportScope, value: string): boolean {
  return INVENTORY_EXPORT_COLUMN_OPTIONS[scope].some((item) => item.key === value);
}

export function inventoryExportHeaders(scope: InventoryExportScope, columns: readonly string[]): string[] {
  const labels = new Map(INVENTORY_EXPORT_COLUMN_OPTIONS[scope].map((item) => [item.key, item.label]));
  return columns.map((key) => labels.get(key) ?? key);
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function searchable(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' ').toLowerCase();
}

function matches(search: string, ...values: Array<string | null | undefined>): boolean {
  const term = normalizeSearch(search);
  return !term || searchable(...values).includes(term);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return direct ? `${direct[3]}/${direct[2]}/${direct[1]}` : '';
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(timestamp));
}

function unitLabel(name: string | null, symbol: string | null, code: string | null): string {
  return String(name || symbol || code || '').trim();
}

function nonZeroDecimal(value: string): boolean {
  const normalized = String(value ?? '').trim().replace(/^[+-]/, '');
  return !/^0+(?:\.0+)?$/.test(normalized || '0');
}

export function isDisplayableInventoryBalance(row: InventoryBalance): boolean {
  return nonZeroDecimal(row.on_hand_quantity) || nonZeroDecimal(row.reserved_quantity);
}

export function matchesInventoryBalanceExport(row: InventoryBalance, search: string): boolean {
  return matches(
    search,
    row.product_name, row.product_code, row.warehouse_code, row.warehouse_name,
    row.location_code, row.location_name, row.base_sku, row.base_variant_name,
    row.base_unit_code, row.base_unit_name, row.package_sku, row.package_variant_name,
    row.package_unit_code, row.package_unit_name, row.lot_code, row.expiry_date,
  );
}

export function matchesInventoryLotExport(row: InventoryLot, search: string): boolean {
  return matches(
    search,
    row.lot_code, row.normalized_lot_code, row.base_sku, row.product_code,
    row.product_name, row.expiry_date, row.supplier_lot_reference,
  );
}

export function matchesInventoryPolicyExport(row: InventoryPolicyExportRecord, search: string): boolean {
  return matches(
    search,
    row.candidate.base_sku,
    row.candidate.base_variant_name,
    row.candidate.product_code,
    row.candidate.product_name,
    row.candidate.related_variant_search_text,
  );
}

function lotTrackingLabel(value: InventoryTrackingPolicy['lot_tracking_mode'] | undefined): string {
  if (!value) return '';
  return value === 'REQUIRED' ? 'Bắt buộc quản lý theo lô' : 'Không quản lý theo lô';
}

function expiryTrackingLabel(value: InventoryTrackingPolicy['expiry_tracking_mode'] | undefined): string {
  if (!value) return '';
  if (value === 'REQUIRED') return 'Bắt buộc nhập hạn sử dụng';
  if (value === 'OPTIONAL') return 'Có thể nhập hạn sử dụng';
  return 'Không quản lý hạn sử dụng';
}

export function inventoryBalanceExportRow(row: InventoryBalance, columns: readonly string[]): string[] {
  const values: Record<string, string> = {
    productCode: row.product_code ?? '',
    productName: row.product_name ?? '',
    baseSku: row.base_sku ?? '',
    baseVariantName: row.base_variant_name ?? '',
    warehouseCode: row.warehouse_code ?? '',
    warehouseName: row.warehouse_name ?? '',
    locationCode: row.location_code ?? '',
    locationName: row.location_name ?? '',
    lotCode: row.lot_code ?? '',
    expiryDate: formatDate(row.expiry_date),
    baseUnit: unitLabel(row.base_unit_name, row.base_unit_symbol, row.base_unit_code),
    onHand: formatExactDecimal(row.on_hand_quantity),
    reserved: formatExactDecimal(row.reserved_quantity),
    available: formatExactDecimal(row.available_quantity),
    packageSku: row.package_sku ?? '',
    packageUnit: unitLabel(row.package_unit_name, row.package_unit_symbol, row.package_unit_code),
    packageConversion: row.package_conversion_to_base ? formatExactDecimal(row.package_conversion_to_base) : '',
  };
  return columns.map((key) => values[key] ?? '');
}

export function inventoryLotExportRow(row: InventoryLot, columns: readonly string[]): string[] {
  const values: Record<string, string> = {
    productCode: row.product_code ?? '',
    productName: row.product_name ?? '',
    baseSku: row.base_sku ?? '',
    baseVariantName: row.base_variant_name ?? '',
    lotCode: row.lot_code ?? '',
    manufacturedDate: formatDate(row.manufactured_date),
    expiryDate: formatDate(row.expiry_date),
    supplierLotReference: row.supplier_lot_reference ?? '',
    createdAt: formatDateTime(row.created_at),
  };
  return columns.map((key) => values[key] ?? '');
}

export function inventoryPolicyExportRow(row: InventoryPolicyExportRecord, columns: readonly string[]): string[] {
  const policy = row.policy;
  const candidate = row.candidate;
  const values: Record<string, string> = {
    productCode: candidate.product_code ?? '',
    productName: candidate.product_name ?? '',
    baseSku: candidate.base_sku ?? '',
    baseVariantName: candidate.base_variant_name ?? '',
    setupStatus: policy ? 'Đã thiết lập' : 'Chưa thiết lập',
    lotTrackingMode: lotTrackingLabel(policy?.lot_tracking_mode),
    expiryTrackingMode: expiryTrackingLabel(policy?.expiry_tracking_mode),
    itemStatus: candidate.base_variant_active && candidate.product_active ? 'Đang hoạt động' : 'Ngừng hoạt động',
  };
  return columns.map((key) => values[key] ?? '');
}
