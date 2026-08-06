export type ReconciliationStatus = 'matched' | 'mismatch';

export type SalesSettlementSummary = Readonly<{
  customerGroupCount: string;
  debitOutstandingAmount: string;
  unappliedCreditAmount: string;
  ledgerBalance: string;
  documentMismatchCount: string;
  anomalyCount: string;
  codCustodyAmount: string;
  collectionMismatchCount: string;
  codPendingAcceptanceAmount: string;
  codAcceptedAmount: string;
  codVarianceAmount: string;
  handoverMismatchCount: string;
}>;

export type CustomerReconciliation = Readonly<{
  customerId: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  currencyCode: string;
  debitPostedAmount: string;
  creditPostedAmount: string;
  debitOutstandingAmount: string;
  unappliedCreditAmount: string;
  calculatedOpenBalance: string;
  ledgerBalance: string;
  documentMismatchCount: string;
  latestDocumentDate: string | null;
  reconciliationStatus: ReconciliationStatus;
}>;

export type DocumentReconciliation = Readonly<{
  id: string;
  customerId: string;
  warehouseId: string;
  salesOrderId: string | null;
  deliveryOrderId: string | null;
  documentType: string;
  direction: 'DEBIT' | 'CREDIT';
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber: string;
  sourceDocumentDate: string;
  customerCodeSnapshot: string;
  customerNameSnapshot: string;
  warehouseCodeSnapshot: string;
  currencyCode: string;
  originalAmount: string;
  projectedAllocatedAmount: string;
  projectedRemainingAmount: string;
  documentStatus: string;
  ledgerAmount: string;
  expectedLedgerAmount: string;
  ledgerMatches: boolean;
  allocationProjectionMatches: boolean;
  reconciliationStatus: ReconciliationStatus;
}>;

export type OrderStatusProjection = Readonly<{
  salesOrderId: string;
  orderNumber: string | null;
  customerId: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  currencyCode: string;
  orderStatus: string;
  fulfillmentStatus: string;
  deliveryStatus: string;
  settlementStatus: string;
  calculatedSettlementStatus: string;
  receivablePostedAmount: string;
  receivableAllocatedAmount: string;
  receivableRemainingAmount: string;
  codCollectedAmount: string;
  codCustodyAmount: string;
  documentMismatchCount: string;
  settlementProjectionMatches: boolean;
  reconciliationStatus: ReconciliationStatus;
  updatedAt: string;
}>;

export type CodCollectionReconciliation = Readonly<{
  collectionId: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  warehouseId: string;
  warehouseCode: string;
  tripId: string;
  tripNumber: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  driverProfileId: string;
  driverCode: string;
  driverName: string;
  collectionMethod: string;
  collectionStatus: string;
  currencyCode: string;
  expectedAmount: string;
  receivedAmount: string;
  handedOverAmount: string;
  custodyRemainingAmount: string;
  reversed: boolean;
  collectedAt: string;
  lifecycleAccountedAmount: string;
  lifecycleMatches: boolean;
  lifecycleStatus: string;
}>;

export type CodHandoverReconciliation = Readonly<{
  handoverId: string;
  warehouseId: string;
  warehouseCode: string;
  tripId: string;
  tripNumber: string;
  driverProfileId: string;
  driverCode: string;
  driverName: string;
  expectedTotal: string;
  handedOverTotal: string;
  unattributedExcessAmount: string;
  claimedAmount: string;
  handoverDifferenceAmount: string;
  pendingAcceptanceAmount: string;
  acceptedAmount: string;
  varianceAmount: string;
  projectionStatus: string;
  handedOverAt: string;
  acceptedAt: string | null;
  reversedAt: string | null;
  lifecycleMatches: boolean;
}>;

export type CloseoutAnomaly = Readonly<{
  anomalyType: string;
  sourceId: string;
  sourceNumber: string;
  reconciliationStatus: ReconciliationStatus;
  details: Readonly<Record<string, unknown>>;
  warehouseId: string;
}>;

export type SalesSettlementReport = Readonly<{
  generatedAt: string;
  filters: Readonly<{ from: string | null; to: string | null; search: string | null; status: 'all' | ReconciliationStatus; limit: number }>;
  summary: SalesSettlementSummary;
  customers: readonly CustomerReconciliation[];
  documents: readonly DocumentReconciliation[];
  orders: readonly OrderStatusProjection[];
  codCollections: readonly CodCollectionReconciliation[];
  codHandovers: readonly CodHandoverReconciliation[];
  anomalies: readonly CloseoutAnomaly[];
}>;
