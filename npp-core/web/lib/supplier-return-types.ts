export type SupplierReturnStatus = 'draft' | 'pending_approval' | 'approved' | 'posted' | 'reversed' | 'cancelled';

export const SUPPLIER_RETURN_PERMISSION_KEYS = {
  read: 'core.supplier-return.read',
  create: 'core.supplier-return.create',
  update: 'core.supplier-return.update',
  submit: 'core.supplier-return.submit',
  approve: 'core.supplier-return.approve',
  cancel: 'core.supplier-return.cancel',
  post: 'core.supplier-return.post',
  reverse: 'core.supplier-return.reverse',
} as const;

export type SupplierReturnPermissionKey = typeof SUPPLIER_RETURN_PERMISSION_KEYS[keyof typeof SUPPLIER_RETURN_PERMISSION_KEYS];

export const SUPPLIER_RETURN_STATUS_LABELS: Record<SupplierReturnStatus, string> = {
  draft: 'Nháp',
  pending_approval: 'Chờ duyệt',
  approved: 'Đã duyệt',
  posted: 'Đã ghi sổ',
  reversed: 'Đã đảo',
  cancelled: 'Đã hủy',
};

export interface SupplierReturnLine {
  id: string;
  lineNumber: number;
  sourceGoodsReceiptId: string;
  sourceGoodsReceiptNumber: string;
  sourceGoodsReceiptStatus: string;
  sourceGoodsReceiptLineId: string;
  sourceGoodsReceiptLineNumber: number;
  sourcePurchaseOrderId: string;
  sourcePurchaseOrderNumber: string;
  sourcePurchaseOrderLineId: string;
  sourcePurchaseOrderLineNumber: number;
  sourceSupplierId: string;
  sourceSupplierCode: string;
  sourceSupplierName: string;
  sourceWarehouseId: string;
  sourceWarehouseCode: string;
  sourceWarehouseName: string;
  sourceVariantId: string;
  sourceSku: string;
  sourceItemName: string;
  sourceUnitId: string;
  sourceUnitCode: string;
  baseVariantId: string;
  baseSku: string;
  conversionToBase: string;
  sourceAcceptedQuantity: string;
  returnQuantity: string;
  baseQuantity: string;
  reasonCode: string;
  reasonNote: string;
  locationId: string | null;
  lotId: string | null;
  lotCode: string | null;
  manufacturedDate: string | null;
  expiryDate: string | null;
  supplierLotReference: string | null;
  note: string | null;
  postedReturnQuantity?: string;
  returnableQuantity?: string;
}

export interface SupplierReturn {
  id: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  status: SupplierReturnStatus;
  documentNumber: string | null;
  returnDate: string;
  note: string | null;
  revision: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  postedAt: string | null;
  postedBy: string | null;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  inventoryMovementId: string | null;
  inventoryReversalMovementId: string | null;
  lineCount: number;
  returnQuantityTotal: string;
  baseQuantityTotal: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  lines?: SupplierReturnLine[];
}

export interface SupplierReturnDraftLine {
  sourceGoodsReceiptLineId: string;
  returnQuantity: string;
  reasonCode: string;
  reasonNote: string;
  note?: string;
}

export interface SupplierReturnDraft {
  supplierId: string;
  warehouseId: string;
  returnDate: string;
  note: string;
  lines: SupplierReturnDraftLine[];
  expectedRevision?: string;
}

export type SupplierReturnActionPolicy = {
  view: boolean;
  create: boolean;
  edit: boolean;
  submit: boolean;
  approve: boolean;
  cancel: boolean;
  post: boolean;
  reverse: boolean;
};

export function supplierReturnActionPolicy(
  status: SupplierReturnStatus,
  permissionKeys: readonly string[],
): SupplierReturnActionPolicy {
  const permissions = new Set(permissionKeys);
  const has = (key: SupplierReturnPermissionKey) => permissions.has(key);
  return {
    view: has(SUPPLIER_RETURN_PERMISSION_KEYS.read),
    create: has(SUPPLIER_RETURN_PERMISSION_KEYS.create),
    edit: status === 'draft' && has(SUPPLIER_RETURN_PERMISSION_KEYS.update),
    submit: status === 'draft' && has(SUPPLIER_RETURN_PERMISSION_KEYS.submit),
    approve: status === 'pending_approval' && has(SUPPLIER_RETURN_PERMISSION_KEYS.approve),
    cancel: ['draft', 'pending_approval', 'approved'].includes(status) && has(SUPPLIER_RETURN_PERMISSION_KEYS.cancel),
    post: status === 'approved' && has(SUPPLIER_RETURN_PERMISSION_KEYS.post),
    reverse: status === 'posted' && has(SUPPLIER_RETURN_PERMISSION_KEYS.reverse),
  };
}

export function formatSupplierReturnDate(value: string | null | undefined): string {
  if (!value) return 'Chưa xác định';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp));
}
