export type DeliveryUser = Readonly<{
  username: string;
  employeeId: string;
  displayName: string;
}>;

export type DeliveryAttemptResult =
  | 'delivered_full'
  | 'delivered_partial'
  | 'failed'
  | 'rescheduled';

export type DeliveryAttemptLine = Readonly<{
  id?: string;
  deliveryOrderLineId: string;
  inventoryIssueLineId: string;
  sku: string | null;
  itemName: string | null;
  unitCode: string | null;
  issuedBaseQuantity: string;
  deliveredBaseQuantity: string | null;
  issuedUnitQuantity?: string | null;
  unitPrice?: string | null;
  lineAmount?: string | null;
}>;

export type DeliveryAttemptSummary = Readonly<{
  id: string;
  result: DeliveryAttemptResult;
  attemptedAt: string;
  reasonCode: string | null;
  note: string | null;
  rescheduledFor: string | null;
}>;

export type DeliveryAttempt = DeliveryAttemptSummary & Readonly<{
  tripId: string;
  stopId: string;
  assignmentId: string;
  deliveryOrderId: string;
  driverProfileId: string;
  lines: readonly DeliveryAttemptLine[];
}>;

export type ProofOfDeliveryType = 'photo' | 'signature' | 'otp' | 'manual_confirm';

export type ProofOfDelivery = Readonly<{
  id: string;
  deliveryAttemptId: string;
  tripId: string;
  assignmentId: string;
  deliveryOrderId: string;
  driverProfileId: string;
  podType: ProofOfDeliveryType;
  receiverName: string | null;
  confirmationReference: string | null;
  note: string | null;
  capturedAt: string;
  file: Readonly<{
    fileName: string;
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    downloadUrl: string | null;
    downloadExpiresIn: number | null;
  }> | null;
}>;

export type AttachProofOfDeliveryPayload = Readonly<{
  podType: ProofOfDeliveryType;
  capturedAt: string;
  receiverName?: string | null;
  confirmationReference?: string | null;
  note?: string | null;
  fileName?: string;
  contentType?: string;
  contentBase64?: string;
}>;

export type AttachProofOfDeliveryResponse = Readonly<{
  ok: true;
  proof: ProofOfDelivery;
  replayed: boolean;
  eventId?: string;
}>;

export type TripAssignment = Readonly<{
  assignmentId: string;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  salesOrderId: string | null;
  customerCode: string | null;
  customerName: string | null;
  requestedDeliveryDate: string | null;
  collectionPolicy: string | null;
  assignedAt: string | null;
  dispatchItemId: string | null;
  inventoryIssueId: string | null;
  currencyCode?: string | null;
  totalAmount?: string | null;
  attempt: DeliveryAttemptSummary | null;
  lines: readonly DeliveryAttemptLine[];
}>;

export type TripStop = Readonly<{
  id: string;
  sequence: number;
  customerId: string;
  customerAddressId: string;
  address: Record<string, unknown>;
  plannedArrivalAt: string | null;
  assignments: readonly TripAssignment[];
}>;

export type DriverTrip = Readonly<{
  id: string;
  number: string;
  status: 'dispatched';
  warehouseId: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  vehicleId: string | null;
  vehicleCode: string | null;
  licensePlate: string | null;
  vehicleType: string | null;
  primaryDriverId: string;
  driverCode: string | null;
  driverName: string | null;
  driverPhone: string | null;
  plannedStartAt: string | null;
  dispatchedAt: string | null;
  handoverReceiverName: string | null;
  handoverNote: string | null;
  note: string | null;
  stopCount?: number;
  assignmentCount?: number;
  attemptCount?: number;
  stops?: readonly TripStop[];
}>;

export type DriverSummary = Readonly<{
  id: string;
  code: string;
  name: string;
  employeeId: string;
}>;

export type DriverTripListResponse = Readonly<{
  driver: DriverSummary;
  trips: readonly DriverTrip[];
}>;

export type DriverTripDetailResponse = Readonly<{
  driver: DriverSummary;
  trip: DriverTrip;
}>;

export type RecordDeliveryAttemptPayload = Readonly<{
  result: DeliveryAttemptResult;
  attemptedAt: string;
  reasonCode?: string | null;
  note?: string | null;
  rescheduledFor?: string | null;
  lines?: readonly Readonly<{
    inventoryIssueLineId: string;
    deliveredBaseQuantity: string;
  }>[];
}>;

export type RecordDeliveryAttemptResponse = Readonly<{
  ok: true;
  attempt: DeliveryAttempt;
  replayed: boolean;
  eventId?: string;
}>;

export type CodCollectionMethod = 'CASH' | 'BANK_TRANSFER' | 'NONE';
export type CodCollectionStatus = 'collected_full' | 'collected_partial' | 'collected_excess' | 'not_collected';

export type CodCollection = Readonly<{
  id: string;
  assignmentId: string;
  deliveryAttemptId: string;
  deliveryOrderId: string;
  customerId: string;
  sourceReceivableDocumentId: string;
  paymentDocumentId: string | null;
  paymentDocumentNumber: string | null;
  collectionMethod: CodCollectionMethod;
  collectionStatus: CodCollectionStatus;
  currencyCode: string;
  expectedAmount: string;
  receivedAmount: string;
  handedOverAmount: string;
  custodyRemainingAmount: string;
  externalReference: string | null;
  reasonCode: string | null;
  promisedBy: string | null;
  dueAt: string | null;
  note: string | null;
  collectedAt: string;
  reversed: boolean;
  reversalReason: string | null;
}>;

export type CodAssignment = Readonly<{
  assignmentId: string;
  stopId: string;
  stopSequence: number;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  collectionPolicy: string | null;
  deliveryAttemptId: string | null;
  deliveryAttemptResult: DeliveryAttemptResult | null;
  receivableDocumentId: string | null;
  receivableDocumentNumber: string | null;
  currencyCode: string | null;
  amountDue: string | null;
  collection: CodCollection | null;
}>;

export type CodHandoverLine = Readonly<{
  id: string;
  collectionId: string;
  expectedAmount: string;
  handedOverAmount: string;
  customerCode: string | null;
  customerName: string | null;
  deliveryOrderNumber: string | null;
}>;

export type CodHandover = Readonly<{
  id: string;
  tripId: string;
  tripNumber: string | null;
  expectedTotal: string;
  handedOverTotal: string;
  unattributedExcessAmount: string;
  differenceAmount: string;
  reason: string | null;
  note: string | null;
  handedOverAt: string;
  status: 'submitted' | 'reconciled' | 'discrepancy' | 'reversed' | 'acceptance_reversed';
  lines: readonly CodHandoverLine[];
}>;

export type DriverCodOverview = Readonly<{
  trip: Readonly<{
    id: string;
    number: string;
    warehouseId: string;
    warehouseCode: string | null;
    warehouseName: string | null;
    driverProfileId: string;
    driverCode: string | null;
    driverName: string | null;
    custodyTotal: string;
  }>;
  assignments: readonly CodAssignment[];
  handovers: readonly CodHandover[];
}>;

export type RecordCodCollectionPayload = Readonly<{
  collectionMethod: CodCollectionMethod;
  receivedAmount?: string;
  externalReference?: string | null;
  reasonCode?: string | null;
  promisedBy?: string | null;
  dueAt?: string | null;
  note?: string | null;
  collectedAt: string;
}>;

export type CreateCodHandoverPayload = Readonly<{
  lines: readonly Readonly<{ collectionId: string; amount: string }>[];
  unattributedExcessAmount?: string;
  reason?: string | null;
  note?: string | null;
  handedOverAt: string;
}>;
