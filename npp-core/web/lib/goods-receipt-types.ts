export type GoodsReceiptStatus = 'draft' | 'posted' | 'reversed';

export const GOODS_RECEIPT_PERMISSION_KEYS = {
  read: 'core.goods-receipt.read',
  create: 'core.goods-receipt.create',
  update: 'core.goods-receipt.update',
  post: 'core.goods-receipt.post',
  reverse: 'core.goods-receipt.reverse',
  variance: 'core.goods-receipt.variance',
} as const;

export type GoodsReceiptPermissionKey = typeof GOODS_RECEIPT_PERMISSION_KEYS[keyof typeof GOODS_RECEIPT_PERMISSION_KEYS];

export const GOODS_RECEIPT_STATUS_LABELS: Record<GoodsReceiptStatus, string> = {
  draft: 'Nháp',
  posted: 'Đã ghi sổ',
  reversed: 'Đã đảo',
};

export interface GoodsReceiptLine {
  id: string;
  lineNumber: number;
  purchaseOrderLineId: string;
  purchaseOrderLineNumber: number;
  warehouseId: string;
  variantId: string;
  skuCode: string;
  itemName: string;
  unitId: string;
  unitCode: string;
  conversionToBase: string;
  orderedQuantity: string;
  receivedQuantityBefore: string;
  remainingQuantityBefore: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  shortageClosedQuantity: string;
  finalizeLine: boolean;
  qualityReasonCode: string | null;
  qualityNote: string | null;
  baseQuantity: string;
  remainingQuantityAfter: string;
  locationId: string | null;
  lotId: string | null;
  lotCode: string | null;
  manufacturedDate: string | null;
  expiryDate: string | null;
  supplierLotReference: string | null;
  note: string | null;
}

export interface GoodsReceipt {
  id: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string | null;
  purchaseOrderStatus: string;
  status: GoodsReceiptStatus;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName: string;
  supplierCode?: string;
  supplierName: string;
  documentNumber: string | null;
  receiptDate: string;
  supplierDeliveryReference: string | null;
  note: string | null;
  revision: string;
  postedAt: string | null;
  postedBy: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  inventoryMovementId: string | null;
  inventoryReversalMovementId: string | null;
  lineCount: number;
  receivedQuantityTotal: string;
  acceptedQuantityTotal: string;
  rejectedQuantityTotal: string;
  shortageClosedQuantityTotal: string;
  baseQuantityTotal: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  lines?: GoodsReceiptLine[];
}

export interface GoodsReceiptDraftLine {
  purchaseOrderLineId: string;
  receivedQuantity: string;
  acceptedQuantity?: string;
  rejectedQuantity?: string;
  finalizeLine?: boolean;
  qualityReasonCode?: string;
  qualityNote?: string;
  locationId: string;
  lotId: string;
  lotCode: string;
  manufacturedDate: string;
  expiryDate: string;
  supplierLotReference: string;
  note: string;
}

export interface GoodsReceiptDraft {
  purchaseOrderId: string;
  receiptDate: string;
  supplierDeliveryReference: string;
  note: string;
  lines: GoodsReceiptDraftLine[];
  expectedRevision?: string;
}

export type GoodsReceiptActionPolicy = {
  view: boolean;
  create: boolean;
  edit: boolean;
  post: boolean;
  reverse: boolean;
  variance: boolean;
};

export function goodsReceiptActionPolicy(
  status: GoodsReceiptStatus,
  permissionKeys: readonly string[],
): GoodsReceiptActionPolicy {
  const permissions = new Set(permissionKeys);
  const has = (key: GoodsReceiptPermissionKey) => permissions.has(key);
  return {
    view: has(GOODS_RECEIPT_PERMISSION_KEYS.read),
    create: has(GOODS_RECEIPT_PERMISSION_KEYS.create),
    edit: status === 'draft' && has(GOODS_RECEIPT_PERMISSION_KEYS.update),
    post: status === 'draft' && has(GOODS_RECEIPT_PERMISSION_KEYS.post),
    reverse: status === 'posted' && has(GOODS_RECEIPT_PERMISSION_KEYS.reverse),
    variance: has(GOODS_RECEIPT_PERMISSION_KEYS.variance),
  };
}

export function formatGoodsReceiptDate(value: string | null | undefined): string {
  if (!value) return 'Chưa xác định';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}

