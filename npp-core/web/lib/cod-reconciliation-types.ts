export type CodHandoverStatus = 'submitted' | 'reconciled' | 'discrepancy' | 'reversed' | 'acceptance_reversed';

export type CodHandoverLine = Readonly<{
  id: string;
  collectionId: string;
  expectedAmount: string;
  handedOverAmount: string;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  deliveryOrderId: string | null;
  deliveryOrderNumber: string | null;
  paymentDocumentId: string | null;
}>;

export type CodAcceptance = Readonly<{
  id: string;
  acceptedAmount: string;
  differenceAmount: string;
  reconciliationStatus: 'reconciled' | 'discrepancy';
  reason: string | null;
  note: string | null;
  acceptedAt: string;
  reversalId: string | null;
}>;

export type CodHandover = Readonly<{
  id: string;
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  tripId: string;
  tripNumber: string | null;
  driverProfileId: string;
  driverCode: string | null;
  driverName: string | null;
  expectedTotal: string;
  handedOverTotal: string;
  unattributedExcessAmount: string;
  differenceAmount: string;
  reason: string | null;
  note: string | null;
  handedOverAt: string;
  status: CodHandoverStatus;
  reversalId: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
  acceptance: CodAcceptance | null;
  lines: readonly CodHandoverLine[];
}>;
