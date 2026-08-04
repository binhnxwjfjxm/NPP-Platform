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
