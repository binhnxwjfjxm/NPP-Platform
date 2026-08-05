export type ReceivableStatus = 'open' | 'partially_allocated' | 'settled' | 'reversed';
export type ReceivableSourceType = 'DELIVERY_ATTEMPT' | 'PICKUP_HANDOVER';

export type ReceivableLine = {
  id: string;
  lineNumber: number;
  salesOrderLineId: string;
  deliveryOrderLineId: string;
  deliveryAttemptLineId: string | null;
  inventoryIssueLineId: string;
  acceptedBaseQuantity: string;
  salesLineBaseQuantitySnapshot: string;
  sku: string;
  itemName: string;
  unitCode: string;
  grossAmount: string;
  discountAmount: string;
  taxAmount: string;
  lineAmount: string;
};

export type ReceivableLedgerEntry = {
  id: string;
  entryType: string;
  amount: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber: string;
  sourceRevision: string;
  documentStatusAfter: string;
  actorId: string;
  requestId: string;
  sourceApp: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export type ReceivableDocument = {
  id: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerAddressId: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  salesOrderId: string;
  salesOrderNumber: string | null;
  salesOrderVersionId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  direction: 'DEBIT' | 'CREDIT';
  documentType: 'SALE_DELIVERY' | 'SALE_PICKUP';
  sourceDocumentType: ReceivableSourceType;
  sourceDocumentId: string;
  sourceDocumentNumber: string;
  sourceDocumentDate: string;
  collectionPolicy: 'PREPAID' | 'COLLECT_ON_DELIVERY' | 'COLLECT_AFTER_DELIVERY' | 'CREDIT_TERMS';
  currencyCode: string;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  status: ReceivableStatus;
  sourceRevision: string;
  postingOrigin: 'runtime' | 'migration_backfill';
  postedAt: string;
  postedBy: string;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  revision: string;
  lines: ReceivableLine[];
  ledgerEntries: ReceivableLedgerEntry[];
};

export type CustomerReceivableBalance = {
  customerId: string;
  customerCode: string;
  customerName: string;
  currencyCode: string;
  balance: string;
  openAmount: string;
  openDocumentCount: number;
  updatedAt: string;
};
