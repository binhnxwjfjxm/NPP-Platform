export type SupplierPaymentStatus = 'open' | 'partially_allocated' | 'settled' | 'reversed';

export type PayableAllocation = {
  id: string;
  sourcePayableDocumentId: string;
  sourceDocumentNumber: string | null;
  sourceDocumentType: string | null;
  targetPayableDocumentId: string;
  targetDocumentNumber: string | null;
  targetDocumentType: string | null;
  amount: string;
  allocationDate: string;
  sourceRevisionBefore: string;
  targetRevisionBefore: string;
  actorId: string;
  requestId: string;
  sourceApp: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  reversed: boolean;
  reversalId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
};

export type SupplierPaymentLedgerEntry = {
  id: string;
  entryType: string;
  amount: string;
  requestId: string;
  sourceApp: string;
  actorId: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export type SupplierPayment = {
  id: string;
  supplierId: string;
  supplierCode: string | null;
  supplierName: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  direction: 'CREDIT';
  documentType: 'SUPPLIER_PAYMENT';
  documentNumber: string;
  paymentDate: string;
  currencyCode: string;
  paymentMethod: string;
  externalReference: string | null;
  note: string | null;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  status: SupplierPaymentStatus;
  revision: string;
  postedAt: string;
  postedBy: string;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  ledgerEntries: SupplierPaymentLedgerEntry[];
  allocations: PayableAllocation[];
};

export type AllocationTarget = {
  id: string;
  documentNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  warehouseId: string;
  warehouseCode: string;
  currencyCode: string;
  dueDate: string;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  status: 'open' | 'partially_allocated';
};

export type SupplierPaymentDraft = {
  supplierId: string;
  warehouseId: string;
  paymentDate: string;
  currencyCode: string;
  paymentMethod: string;
  amount: string;
  externalReference?: string;
  note?: string;
};
