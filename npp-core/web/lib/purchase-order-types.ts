export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_received'
  | 'fully_received'
  | 'closed'
  | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  skuId: string;
  skuCode: string;
  unitId: string;
  unitCode?: string;
  quantity: string; // decimal string at domain boundary
  conversionToBase: string; // decimal string snapshot
  baseQuantityPreview?: string; // decimal string
  unitPrice: string; // decimal string
  discount?: string; // decimal string or percent snapshot
  tax?: string; // decimal string
  lineTotal: string; // decimal string
  note?: string;
}

export interface PurchaseOrder {
  id: string;
  number?: string | null; // may be null/undefined for drafts
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName?: string;
  warehouseId: string;
  placedAt: string; // ISO date
  expectedAt?: string | null; // ISO date
  currency?: string;
  note?: string;
  createdBy?: string;
  approvedBy?: string | null;
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
