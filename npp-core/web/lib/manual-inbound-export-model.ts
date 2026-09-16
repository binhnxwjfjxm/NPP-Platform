export type ManualInboundExportStatus = 'POSTED' | 'REVERSED';
export type ManualInboundExportType = 'MANUAL_RECEIPT' | 'OFF_DOCUMENT_CUSTOMER_RETURN' | 'RECOVERY' | 'OTHER';

export type ManualInboundExportDocument = Readonly<{
  inboundType: ManualInboundExportType;
  warehouseCode: string;
  warehouseName: string;
  documentDate: string;
  referenceNumber: string | null;
  note: string | null;
  createdAt: string;
  status: ManualInboundExportStatus;
  reversalDate: string | null;
  reversalNote: string | null;
}>;

export const MANUAL_INBOUND_TYPE_LABELS: Readonly<Record<ManualInboundExportType, string>> = Object.freeze({
  MANUAL_RECEIPT: 'Nhập hàng thủ công',
  OFF_DOCUMENT_CUSTOMER_RETURN: 'Khách trả ngoài chứng từ',
  RECOVERY: 'Hàng thu hồi',
  OTHER: 'Khác',
});

export const MANUAL_INBOUND_STATUS_LABELS: Readonly<Record<ManualInboundExportStatus, string>> = Object.freeze({
  POSTED: 'Đã nhập',
  REVERSED: 'Đã đảo',
});

export const MANUAL_INBOUND_EXPORT_COLUMN_LABELS = Object.freeze({
  documentDate: 'Ngày chứng từ',
  referenceNumber: 'Số chứng từ tham chiếu',
  inboundType: 'Loại nhập',
  warehouseCode: 'Mã kho',
  warehouseName: 'Kho nhập',
  status: 'Trạng thái',
  note: 'Ghi chú',
  createdAt: 'Thời gian ghi nhận',
  reversalDate: 'Ngày đảo',
  reversalNote: 'Lý do đảo',
} as const);

export type ManualInboundExportColumnKey = keyof typeof MANUAL_INBOUND_EXPORT_COLUMN_LABELS;

export const MANUAL_INBOUND_EXPORT_COLUMN_OPTIONS = Object.freeze(
  Object.entries(MANUAL_INBOUND_EXPORT_COLUMN_LABELS).map(([key, label]) => Object.freeze({
    key: key as ManualInboundExportColumnKey,
    label,
  })),
);

export const MANUAL_INBOUND_EXPORT_DEFAULT_COLUMNS: readonly ManualInboundExportColumnKey[] = Object.freeze([
  'documentDate',
  'referenceNumber',
  'inboundType',
  'warehouseCode',
  'warehouseName',
  'status',
  'note',
  'createdAt',
]);

const VALID_COLUMN_KEYS = new Set<ManualInboundExportColumnKey>(
  Object.keys(MANUAL_INBOUND_EXPORT_COLUMN_LABELS) as ManualInboundExportColumnKey[],
);

export function isManualInboundExportColumnKey(value: string): value is ManualInboundExportColumnKey {
  return VALID_COLUMN_KEYS.has(value as ManualInboundExportColumnKey);
}

export function isManualInboundExportType(value: string): value is ManualInboundExportType {
  return Object.prototype.hasOwnProperty.call(MANUAL_INBOUND_TYPE_LABELS, value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (direct) return `${direct[3]}/${direct[2]}/${direct[1]}`;
  return '';
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

function valueFor(document: ManualInboundExportDocument, key: ManualInboundExportColumnKey): string {
  if (key === 'documentDate') return formatDate(document.documentDate);
  if (key === 'referenceNumber') return document.referenceNumber ?? '';
  if (key === 'inboundType') return MANUAL_INBOUND_TYPE_LABELS[document.inboundType] ?? document.inboundType;
  if (key === 'warehouseCode') return document.warehouseCode ?? '';
  if (key === 'warehouseName') return document.warehouseName ?? '';
  if (key === 'status') return MANUAL_INBOUND_STATUS_LABELS[document.status] ?? document.status;
  if (key === 'note') return document.note ?? '';
  if (key === 'createdAt') return formatDateTime(document.createdAt);
  if (key === 'reversalDate') return formatDate(document.reversalDate);
  if (key === 'reversalNote') return document.reversalNote ?? '';
  return '';
}

export function manualInboundExportHeaders(columns: readonly ManualInboundExportColumnKey[]): string[] {
  return columns.map((key) => MANUAL_INBOUND_EXPORT_COLUMN_LABELS[key]);
}

export function manualInboundExportRow(
  document: ManualInboundExportDocument,
  columns: readonly ManualInboundExportColumnKey[],
): string[] {
  return columns.map((key) => valueFor(document, key));
}
