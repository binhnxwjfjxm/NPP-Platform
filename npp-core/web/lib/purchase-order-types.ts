export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_received'
  | 'fully_received'
  | 'closed'
  | 'cancelled';

export const PURCHASE_ORDER_PERMISSION_KEYS = {
  read: 'core.purchase-order.read',
  create: 'core.purchase-order.create',
  update: 'core.purchase-order.update',
  submit: 'core.purchase-order.submit',
  approve: 'core.purchase-order.approve',
  cancel: 'core.purchase-order.cancel',
} as const;

export type PurchaseOrderPermissionKey = typeof PURCHASE_ORDER_PERMISSION_KEYS[keyof typeof PURCHASE_ORDER_PERMISSION_KEYS];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Nháp',
  pending_approval: 'Chờ duyệt',
  approved: 'Đã duyệt',
  partially_received: 'Đã nhận một phần',
  fully_received: 'Đã nhận đủ',
  closed: 'Đã đóng',
  cancelled: 'Đã hủy',
};

export interface PurchaseOrderLine {
  id: string;
  lineNumber: number;
  variantId: string;
  skuCode: string;
  itemName: string;
  unitId: string;
  unitCode: string;
  conversionToBase: string;
  quantity: string;
  baseQuantity: string;
  receivedQuantity?: string;
  remainingQuantity?: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  lineTotal: string;
  note?: string | null;
}

export interface PurchaseOrder {
  id: string;
  number: string | null;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierCode?: string;
  supplierName: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName: string;
  placedAt: string;
  expectedAt: string | null;
  supplierReference: string | null;
  currency: string;
  note: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  revision: string;
  lineCount: number;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderDraftLine {
  variantId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxAmount: string;
  note: string;
}

export interface PurchaseOrderDraft {
  supplierId: string;
  warehouseId: string;
  orderDate: string;
  expectedDate: string;
  supplierReference: string;
  currencyCode: string;
  note: string;
  lines: PurchaseOrderDraftLine[];
  expectedRevision?: string;
}

export interface PurchaseOrderSupplierOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface PurchaseOrderWarehouseOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface PurchaseOrderVariantOption {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  conversionToBase: string;
  allowsFractional: boolean;
  isActive: boolean;
  isPurchasable: boolean;
}

export interface ListPurchaseOrdersParams {
  limit?: number;
  offset?: number;
  status?: PurchaseOrderStatus | 'all';
  supplierId?: string;
  warehouseId?: string;
  search?: string;
}

export type PurchaseOrderActionPolicy = {
  view: boolean;
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  cancel: boolean;
};

export function purchaseOrderActionPolicy(
  status: PurchaseOrderStatus,
  permissionKeys: readonly string[],
): PurchaseOrderActionPolicy {
  const permissions = new Set(permissionKeys);
  const has = (key: PurchaseOrderPermissionKey) => permissions.has(key);

  return {
    view: has(PURCHASE_ORDER_PERMISSION_KEYS.read),
    create: has(PURCHASE_ORDER_PERMISSION_KEYS.create),
    edit: status === 'draft' && has(PURCHASE_ORDER_PERMISSION_KEYS.update),
    submit: status === 'draft' && has(PURCHASE_ORDER_PERMISSION_KEYS.submit),
    approve: status === 'pending_approval' && has(PURCHASE_ORDER_PERMISSION_KEYS.approve),
    cancel: ['draft', 'pending_approval', 'approved'].includes(status) && has(PURCHASE_ORDER_PERMISSION_KEYS.cancel),
  };
}

export function formatPurchaseOrderDate(value: string | null | undefined): string {
  if (!value) return 'Chưa xác định';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}

export function formatDecimalString(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return '—';

  const sign = match[1];
  const integer = match[2].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = match[3]?.replace(/0+$/, '') ?? '';
  return `${sign}${integer}${fraction ? `,${fraction}` : ''}`;
}

export function formatPurchaseOrderAmount(value: string | null | undefined, currency = 'VND'): string {
  const amount = formatDecimalString(value);
  return amount === '—' ? amount : `${amount} ${currency.trim() || 'VND'}`;
}

const SCALE = 1_000_000n;
const DECIMAL_PATTERN = /^(0|[1-9]\d{0,13})(?:\.(\d{1,6}))?$/;

export function decimalToScaled(value: string, allowZero = true): bigint | null {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const scaled = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(6, '0') || '0');
  return !allowZero && scaled === 0n ? null : scaled;
}

export function scaledToDecimal(value: bigint): string {
  const integer = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

export function multiplyScaled(left: bigint, right: bigint): bigint {
  return (left * right + SCALE / 2n) / SCALE;
}

export function calculatePurchaseOrderDraftTotals(lines: readonly PurchaseOrderDraftLine[]) {
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;
  const lineTotals: string[] = [];
  for (const line of lines) {
    const quantity = decimalToScaled(line.quantity, false);
    const unitPrice = decimalToScaled(line.unitPrice || '0');
    const discount = decimalToScaled(line.discountAmount || '0');
    const tax = decimalToScaled(line.taxAmount || '0');
    if (quantity === null || unitPrice === null || discount === null || tax === null) {
      lineTotals.push('0');
      continue;
    }
    const gross = multiplyScaled(quantity, unitPrice);
    const total = gross - discount + tax;
    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    lineTotals.push(scaledToDecimal(total < 0n ? 0n : total));
  }
  return Object.freeze({
    subtotal: scaledToDecimal(subtotal),
    discountTotal: scaledToDecimal(discountTotal),
    taxTotal: scaledToDecimal(taxTotal),
    total: scaledToDecimal(subtotal - discountTotal + taxTotal),
    lineTotals: Object.freeze(lineTotals),
  });
}
