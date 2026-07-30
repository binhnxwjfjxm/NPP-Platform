export type PayableDirection = 'DEBIT' | 'CREDIT';
export type PayableStatus = 'open' | 'partially_allocated' | 'settled' | 'reversed';

export type PayableLine = {
  id: string; lineNumber: number; sourceGoodsReceiptLineId: string; sourceSupplierReturnLineId: string | null;
  sourcePurchaseOrderLineId: string; sku: string; itemName: string; unitCode: string; quantity: string;
  unitPrice: string; grossAmount: string; discountAmount: string; taxAmount: string; lineAmount: string;
};
export type PayableLedgerEntry = {
  id: string; entryType: string; amount: string; sourceRevision: string; documentStatusAfter: string;
  actorId: string; requestId: string; sourceApp: string; occurredAt: string; metadata: Record<string, unknown>;
};
export type PayableAllocationHistory = {
  id: string; sourcePayableDocumentId: string; sourceDocumentNumber: string; sourceDocumentType: string;
  targetPayableDocumentId: string; targetDocumentNumber: string; targetDocumentType: string;
  amount: string; allocationDate: string; createdAt: string; reversed: boolean;
  reversalId: string | null; reversalReason: string | null; reversedAt: string | null;
};
export type PayableDocument = {
  id: string; supplierId: string; supplierCode: string | null; supplierName: string | null;
  warehouseId: string; warehouseCode: string | null; warehouseName: string | null;
  direction: PayableDirection; documentType: 'GOODS_RECEIPT' | 'SUPPLIER_RETURN_CREDIT' | 'SUPPLIER_PAYMENT';
  sourceDocumentType: 'GOODS_RECEIPT' | 'SUPPLIER_RETURN' | 'SUPPLIER_PAYMENT'; sourceDocumentId: string; sourceDocumentNumber: string;
  sourceDocumentDate: string; currencyCode: string; paymentMethod: string; paymentTermDays: number; dueDate: string;
  originalAmount: string; allocatedAmount: string; remainingAmount: string; signedOriginalAmount: string;
  status: PayableStatus; sourceRevision: string; postingOrigin: 'runtime' | 'migration_backfill'; postedAt: string;
  postedBy: string; reversedAt: string | null; reversedBy: string | null; reversalReason: string | null;
  revision: string; lines: PayableLine[]; ledgerEntries: PayableLedgerEntry[]; allocations: PayableAllocationHistory[];
};
export type SupplierPayableBalance = {
  supplierId: string; supplierCode: string; supplierName: string; currencyCode: string; balance: string;
  openAmount: string; overdueAmount: string; openDocumentCount: number; updatedAt: string;
};
