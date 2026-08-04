export type DeliveryUser = Readonly<{
  username: string;
  employeeId: string;
  displayName: string;
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
