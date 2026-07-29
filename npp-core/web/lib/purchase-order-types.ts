export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_received'
  | 'fully_received'
  | 'closed'
  | 'cancelled';

export const PURCHASE_ORDER_PERMISSION_KEYS = {
  read: 'purchasing.purchase_order.read',
  create: 'purchasing.purchase_order.create',
  update: 'purchasing.purchase_order.update',
  submit: 'purchasing.purchase_order.submit',
  approve: 'purchasing.purchase_order.approve',
  cancel: 'purchasing.purchase_order.cancel',
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
  skuId: string;
  skuCode: string;
  skuName?: string;
  unitId: string;
  unitCode?: string;
  quantity: string;
  conversionToBase: string;
  baseQuantityPreview?: string;
  receivedQuantity?: string;
  remainingQuantity?: string;
  unitPrice: string;
  discount?: string;
  tax?: string;
  lineTotal: string;
  note?: string;
}

export interface PurchaseOrder {
  id: string;
  number?: string | null;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName?: string;
  warehouseId: string;
  warehouseName?: string;
  placedAt: string;
  expectedAt?: string | null;
  currency?: string;
  supplierReference?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
  approvedBy?: string | null;
  approvedByName?: string | null;
  lines: PurchaseOrderLine[];
  subtotal: string;
  discountTotal?: string;
  taxTotal?: string;
  total: string;
  revision?: number;
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
    cancel: (status === 'draft' || status === 'pending_approval') && has(PURCHASE_ORDER_PERMISSION_KEYS.cancel),
  };
}

export function formatPurchaseOrderDate(value: string | null | undefined): string {
  if (!value) return 'Chưa xác định';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN').format(new Date(timestamp));
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
