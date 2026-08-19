export type CustomerPaymentStatus = 'open' | 'partially_allocated' | 'settled' | 'reversed';

export type ReceivableAllocation = {
  id: string;
  sourceReceivableDocumentId: string;
  sourceDocumentNumber: string | null;
  sourceDocumentType: string | null;
  sourceWarehouseId: string | null;
  targetReceivableDocumentId: string;
  targetDocumentNumber: string | null;
  targetDocumentType: string | null;
  targetWarehouseId: string | null;
  salesOrderId: string | null;
  deliveryOrderId: string | null;
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

export type CustomerPaymentLedgerEntry = {
  id: string;
  entryType: string;
  amount: string;
  requestId: string;
  sourceApp: string;
  actorId: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export type CustomerPayment = {
  id: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  direction: 'CREDIT';
  documentType: 'CUSTOMER_PAYMENT';
  documentNumber: string;
  paymentDate: string;
  currencyCode: string;
  paymentMethod: string;
  externalReference: string | null;
  note: string | null;
  remittingEmployeeId: string | null;
  remittingEmployeeCode: string | null;
  remittingEmployeeName: string | null;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  relatedDocumentNumbers: string[];
  relatedSalesOrderNumbers: string[];
  relatedReceivableCount: number;
  relatedRemainingAmount: string;
  status: CustomerPaymentStatus;
  revision: string;
  postedAt: string;
  postedBy: string;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  ledgerEntries: CustomerPaymentLedgerEntry[];
  allocations: ReceivableAllocation[];
};

export type ReceivableAllocationTarget = {
  id: string;
  documentNumber: string;
  sourceDocumentType: string;
  sourceDocumentDate: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  salesOrderId: string;
  salesOrderNumber: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string;
  currencyCode: string;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  status: 'open' | 'partially_allocated';
};

export type CustomerPaymentAllocationDraft = {
  receivableDocumentId: string;
  amount: string;
};

export type CustomerPaymentDraft = {
  customerId: string;
  warehouseId: string;
  paymentDate: string;
  currencyCode: string;
  paymentMethod: string;
  amount: string;
  remittingEmployeeId?: string;
  externalReference?: string;
  note?: string;
  allocations?: CustomerPaymentAllocationDraft[];
};

export type RemittingEmployeeOption = {
  id: string;
  code: string;
  fullName: string;
};
