import {
  adjustmentKindLabels,
  adjustmentStatusLabels,
  type AdjustmentKind,
  type AdjustmentStatus,
  type InventoryAdjustment,
} from './inventory-adjustment-types';

export const INVENTORY_ADJUSTMENT_EXPORT_COLUMN_LABELS = Object.freeze({
  adjustmentNumber: 'Số phiếu',
  createdAt: 'Ngày lập',
  warehouseCode: 'Mã kho',
  warehouseName: 'Kho',
  documentKind: 'Loại phiếu',
  adjustmentDirection: 'Điều chỉnh',
  status: 'Trạng thái',
  reasonLabel: 'Lý do',
  reasonNote: 'Diễn giải',
  lineCount: 'Số dòng',
  submittedAt: 'Gửi duyệt lúc',
  approvedAt: 'Duyệt lúc',
  postedAt: 'Cập nhật tồn lúc',
  cancelledAt: 'Hủy lúc',
  reversedAt: 'Hoàn tác lúc',
} as const);

export type InventoryAdjustmentExportColumnKey = keyof typeof INVENTORY_ADJUSTMENT_EXPORT_COLUMN_LABELS;

export const INVENTORY_ADJUSTMENT_EXPORT_COLUMN_OPTIONS = Object.freeze(
  Object.entries(INVENTORY_ADJUSTMENT_EXPORT_COLUMN_LABELS).map(([key, label]) => Object.freeze({
    key: key as InventoryAdjustmentExportColumnKey,
    label,
  })),
);

export const INVENTORY_ADJUSTMENT_EXPORT_DEFAULT_COLUMNS: readonly InventoryAdjustmentExportColumnKey[] = Object.freeze([
  'adjustmentNumber',
  'createdAt',
  'warehouseCode',
  'warehouseName',
  'documentKind',
  'adjustmentDirection',
  'status',
  'reasonLabel',
  'lineCount',
  'postedAt',
]);

const COLUMN_KEYS = new Set<InventoryAdjustmentExportColumnKey>(
  Object.keys(INVENTORY_ADJUSTMENT_EXPORT_COLUMN_LABELS) as InventoryAdjustmentExportColumnKey[],
);

export function isInventoryAdjustmentExportColumnKey(value: string): value is InventoryAdjustmentExportColumnKey {
  return COLUMN_KEYS.has(value as InventoryAdjustmentExportColumnKey);
}

export function isInventoryAdjustmentKind(value: string): value is AdjustmentKind {
  return Object.prototype.hasOwnProperty.call(adjustmentKindLabels, value);
}

export function isInventoryAdjustmentStatus(value: string): value is AdjustmentStatus {
  return Object.prototype.hasOwnProperty.call(adjustmentStatusLabels, value);
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

function directionLabel(value: InventoryAdjustment['adjustmentDirection']): string {
  if (value === 'IN') return 'Tăng tồn';
  if (value === 'OUT') return 'Giảm tồn';
  return '';
}

function valueFor(document: InventoryAdjustment, key: InventoryAdjustmentExportColumnKey): string {
  if (key === 'adjustmentNumber') return document.adjustmentNumber;
  if (key === 'createdAt') return formatDateTime(document.createdAt);
  if (key === 'warehouseCode') return document.warehouseCode ?? '';
  if (key === 'warehouseName') return document.warehouseName ?? '';
  if (key === 'documentKind') return adjustmentKindLabels[document.documentKind] ?? document.documentKind;
  if (key === 'adjustmentDirection') return directionLabel(document.adjustmentDirection);
  if (key === 'status') return adjustmentStatusLabels[document.status] ?? document.status;
  if (key === 'reasonLabel') return document.reasonLabel ?? document.reasonCode;
  if (key === 'reasonNote') return document.reasonNote ?? '';
  if (key === 'lineCount') return String(document.lineCount ?? 0);
  if (key === 'submittedAt') return formatDateTime(document.submittedAt);
  if (key === 'approvedAt') return formatDateTime(document.approvedAt);
  if (key === 'postedAt') return formatDateTime(document.postedAt);
  if (key === 'cancelledAt') return formatDateTime(document.cancelledAt);
  if (key === 'reversedAt') return formatDateTime(document.reversedAt);
  return '';
}

export function inventoryAdjustmentExportHeaders(columns: readonly InventoryAdjustmentExportColumnKey[]): string[] {
  return columns.map((key) => INVENTORY_ADJUSTMENT_EXPORT_COLUMN_LABELS[key]);
}

export function inventoryAdjustmentExportRow(
  document: InventoryAdjustment,
  columns: readonly InventoryAdjustmentExportColumnKey[],
): string[] {
  return columns.map((key) => valueFor(document, key));
}
