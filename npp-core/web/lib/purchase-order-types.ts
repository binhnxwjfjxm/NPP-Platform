import {
  calculatePurchaseOrderDraftTotals as calculateLineEntryTotals,
  decimalToScaled as lineEntryDecimalToScaled,
  formatDecimalForDisplay,
  multiplyScaled as lineEntryMultiplyScaled,
  scaledToDecimal as lineEntryScaledToDecimal,
} from './purchase-order-line-entry';

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
  priceRead: 'core.purchase-order.price.read',
  priceOverride: 'core.purchase-order.price.override',
  purchasePriceRead: 'core.supplier-purchase-price.read',
  purchasePriceManage: 'core.supplier-purchase-price.manage',
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

export type PurchaseOrderDiscountMode = 'TOTAL_AMOUNT' | 'PER_UNIT' | 'PERCENT';
export type PurchaseOrderPriceStatus = 'RESOLVED' | 'NOT_FOUND';
export type PurchaseOrderPriceSource = 'SUPPLIER_PRICE' | 'MANUAL_OVERRIDE' | null;

export type PurchaseOrderSkuEligibility = {
  selectable: boolean;
  code: string;
  message: string;
};

export interface PurchaseOrderSkuSearchOption {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  sku: string;
  variantName: string;
  barcode: string | null;
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  conversionToBase: string | null;
  allowsFractional: boolean | null;
  eligibility: PurchaseOrderSkuEligibility;
}

export interface PurchaseOrderSkuResolution {
  identifier: string;
  option: PurchaseOrderSkuSearchOption | null;
  error: { code: string; message: string } | null;
}

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
  acceptedQuantity?: string;
  rejectedQuantity?: string;
  shortageClosedQuantity?: string;
  remainingQuantity?: string;
  unitPrice?: string;
  discountMode?: PurchaseOrderDiscountMode;
  discountValue?: string;
  discountAmount?: string;
  taxRate?: string | null;
  taxAmount?: string;
  lineTotal?: string;
  priceStatus?: PurchaseOrderPriceStatus;
  purchasePriceId?: string | null;
  purchasePriceSource?: PurchaseOrderPriceSource;
  purchasePriceResolvedAt?: string | null;
  supplierSkuSnapshot?: string | null;
  priceOverrideReason?: string | null;
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
  subtotal?: string;
  discountTotal?: string;
  taxTotal?: string;
  total?: string;
  priceStatus?: PurchaseOrderPriceStatus;
  revision: string;
  lineCount: number;
  receiptCount: number;
  receivedQuantityTotal: string | null;
  acceptedQuantityTotal: string | null;
  rejectedQuantityTotal: string | null;
  shortageClosedQuantityTotal: string | null;
  remainingQuantityTotal: string | null;
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
  unitPrice?: string;
  discountMode?: PurchaseOrderDiscountMode;
  discountValue?: string;
  discountAmount?: string;
  taxRate?: string;
  taxAmount?: string;
  priceOverrideReason?: string;
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

export interface PurchaseOrderSupplierOption { id: string; code: string; name: string; isActive: boolean; }
export interface PurchaseOrderWarehouseOption { id: string; code: string; name: string; isActive: boolean; }
export interface PurchaseOrderVariantOption {
  id: string; productId: string; sku: string; name: string; unitId: string; unitCode: string; unitName: string;
  conversionToBase: string; allowsFractional: boolean; isActive: boolean; isPurchasable: boolean;
}

export interface SupplierPurchasePrice {
  id: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  variantId: string;
  sku: string;
  variantName: string;
  productCode: string;
  productName: string;
  unitId: string;
  unitCode: string;
  unitName: string;
  currencyCode: string;
  unitPrice: string;
  minQuantity: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  supplierSku: string | null;
  sourceReference: string | null;
  note: string | null;
  isActive: boolean;
  revision: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierPurchasePriceResolution {
  status: PurchaseOrderPriceStatus;
  price?: SupplierPurchasePrice;
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
  priceRead: boolean;
  priceOverride: boolean;
};

export function purchaseOrderActionPolicy(status: PurchaseOrderStatus, permissionKeys: readonly string[]): PurchaseOrderActionPolicy {
  const permissions = new Set(permissionKeys);
  const has = (key: PurchaseOrderPermissionKey) => permissions.has(key);
  return {
    view: has(PURCHASE_ORDER_PERMISSION_KEYS.read),
    create: has(PURCHASE_ORDER_PERMISSION_KEYS.create),
    edit: status === 'draft' && has(PURCHASE_ORDER_PERMISSION_KEYS.update),
    submit: status === 'draft' && has(PURCHASE_ORDER_PERMISSION_KEYS.submit),
    approve: status === 'pending_approval'
      && has(PURCHASE_ORDER_PERMISSION_KEYS.approve)
      && has(PURCHASE_ORDER_PERMISSION_KEYS.priceRead),
    cancel: ['draft', 'pending_approval', 'approved'].includes(status) && has(PURCHASE_ORDER_PERMISSION_KEYS.cancel),
    priceRead: has(PURCHASE_ORDER_PERMISSION_KEYS.priceRead),
    priceOverride: has(PURCHASE_ORDER_PERMISSION_KEYS.priceOverride),
  };
}

export function formatPurchaseOrderDate(value: string | null | undefined): string {
  if (!value) return 'Chưa xác định';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(timestamp));
}

export function formatDecimalString(value: string | null | undefined): string {
  return formatDecimalForDisplay(value);
}

export function formatPurchaseOrderAmount(value: string | null | undefined, currency = 'VND'): string {
  const amount = formatDecimalString(value);
  return amount === '—' ? amount : `${amount} ${currency.trim() || 'VND'}`;
}

export function decimalToScaled(value: string, allowZero = true): bigint | null {
  return lineEntryDecimalToScaled(value, allowZero);
}

export function scaledToDecimal(value: bigint): string {
  return lineEntryScaledToDecimal(value);
}

export function multiplyScaled(left: bigint, right: bigint): bigint {
  return lineEntryMultiplyScaled(left, right);
}

export function calculatePurchaseOrderDraftTotals(lines: readonly PurchaseOrderDraftLine[]) {
  return calculateLineEntryTotals(lines);
}
