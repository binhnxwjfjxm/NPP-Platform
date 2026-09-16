import type { PurchaseOrder } from './purchase-order-types';
import { PURCHASE_ORDER_STATUS_LABELS } from './purchase-order-types';

export const PURCHASE_ORDER_EXPORT_COLUMN_LABELS = Object.freeze({
  number: 'Số đơn',
  status: 'Trạng thái',
  placedAt: 'Ngày đặt',
  expectedAt: 'Ngày dự kiến nhận',
  supplierCode: 'Mã nhà cung cấp',
  supplierName: 'Nhà cung cấp',
  supplierReference: 'Tham chiếu nhà cung cấp',
  warehouseCode: 'Mã kho nhận',
  warehouseName: 'Kho nhận',
  lineCount: 'Số dòng',
  subtotal: 'Tiền hàng',
  discountTotal: 'Chiết khấu',
  taxTotal: 'Thuế',
  total: 'Tổng giá trị',
  currency: 'Tiền tệ',
  note: 'Ghi chú',
  createdAt: 'Ngày tạo',
  updatedAt: 'Cập nhật lần cuối',
} as const);

export type PurchaseOrderExportColumnKey = keyof typeof PURCHASE_ORDER_EXPORT_COLUMN_LABELS;

export const PURCHASE_ORDER_EXPORT_COLUMN_OPTIONS = Object.freeze(
  Object.entries(PURCHASE_ORDER_EXPORT_COLUMN_LABELS).map(([key, label]) => Object.freeze({
    key: key as PurchaseOrderExportColumnKey,
    label,
  })),
);

export const PURCHASE_ORDER_EXPORT_DEFAULT_COLUMNS: readonly PurchaseOrderExportColumnKey[] = Object.freeze([
  'number',
  'placedAt',
  'expectedAt',
  'supplierCode',
  'supplierName',
  'supplierReference',
  'warehouseCode',
  'warehouseName',
  'lineCount',
  'total',
  'currency',
  'status',
]);

const VALID_COLUMN_KEYS = new Set<PurchaseOrderExportColumnKey>(
  Object.keys(PURCHASE_ORDER_EXPORT_COLUMN_LABELS) as PurchaseOrderExportColumnKey[],
);

export function isPurchaseOrderExportColumnKey(value: string): value is PurchaseOrderExportColumnKey {
  return VALID_COLUMN_KEYS.has(value as PurchaseOrderExportColumnKey);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const direct = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10));
  if (direct) return `${direct[3]}/${direct[2]}/${direct[1]}`;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(timestamp));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(timestamp));
}

function formatDecimal(value: string | number | null | undefined): string {
  const source = String(value ?? '').trim();
  if (!source) return '';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(source);
  if (!match) return source;
  const sign = match[1];
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `,${fraction}` : ''}`;
}

function valueFor(order: PurchaseOrder, key: PurchaseOrderExportColumnKey): string {
  if (key === 'number') return order.number || 'Chưa cấp số';
  if (key === 'status') return PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status;
  if (key === 'placedAt') return formatDate(order.placedAt);
  if (key === 'expectedAt') return formatDate(order.expectedAt);
  if (key === 'supplierCode') return order.supplierCode ?? '';
  if (key === 'supplierName') return order.supplierName ?? '';
  if (key === 'supplierReference') return order.supplierReference ?? '';
  if (key === 'warehouseCode') return order.warehouseCode ?? '';
  if (key === 'warehouseName') return order.warehouseName ?? '';
  if (key === 'lineCount') return String(order.lineCount ?? 0);
  if (key === 'subtotal') return formatDecimal(order.subtotal);
  if (key === 'discountTotal') return formatDecimal(order.discountTotal);
  if (key === 'taxTotal') return formatDecimal(order.taxTotal);
  if (key === 'total') return formatDecimal(order.total);
  if (key === 'currency') return order.currency || 'VND';
  if (key === 'note') return order.note ?? '';
  if (key === 'createdAt') return formatDateTime(order.createdAt);
  if (key === 'updatedAt') return formatDateTime(order.updatedAt);
  return '';
}

export function purchaseOrderExportHeaders(columns: readonly PurchaseOrderExportColumnKey[]): string[] {
  return columns.map((key) => PURCHASE_ORDER_EXPORT_COLUMN_LABELS[key]);
}

export function purchaseOrderExportRow(
  order: PurchaseOrder,
  columns: readonly PurchaseOrderExportColumnKey[],
): string[] {
  return columns.map((key) => valueFor(order, key));
}
