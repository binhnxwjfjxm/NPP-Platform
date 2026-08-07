export type LogisticsSummary = Readonly<{
  tripCount?: string;
  dispatchedTripCount?: string;
  closedTripCount?: string;
  stopCount?: string;
  deliveryOrderCount?: string;
  attemptCount?: string;
  deliveredFullCount?: string;
  deliveredPartialCount?: string;
  failedCount?: string;
  rescheduledCount?: string;
  onTimeEligibleFullCount?: string;
  onTimeFullCount?: string;
  lateFullCount?: string;
  fullWithoutPlanCount?: string;
  pendingResultCount?: string;
  onTimeFullRatePercent?: string | null;
  slaCoveragePercent?: string | null;
  averageClosedTripDurationMinutes?: string | null;
}>;

export type LogisticsStatusRow = Readonly<{
  status: string;
  tripCount: string;
  stopCount: string;
  deliveryOrderCount: string;
}>;

export type LogisticsWarehouseRow = Readonly<{
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
}>;

export type LogisticsActorRow = Readonly<{
  driverProfileId?: string | null;
  driverCode?: string | null;
  driverName?: string | null;
  employeeId?: string | null;
  vehicleId?: string | null;
  vehicleCode?: string | null;
  licensePlate?: string | null;
  vehicleType?: string | null;
  tripCount: string;
  dispatchedTripCount: string;
  closedTripCount: string;
  stopCount: string;
  deliveryOrderCount: string;
  deliveredFullCount: string;
  deliveredPartialCount: string;
  failedCount: string;
  rescheduledCount: string;
  onTimeFullRatePercent: string | null;
  averageClosedTripDurationMinutes: string | null;
}>;

export type LogisticsFailureReasonRow = Readonly<{
  result: 'failed' | 'rescheduled';
  reasonCode: string;
  attemptCount: string;
}>;

export type LogisticsTripRow = Readonly<{
  tripId: string;
  tripNumber: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  deliveryRouteId: string | null;
  routeCode: string | null;
  routeName: string | null;
  vehicleId: string | null;
  vehicleCode: string | null;
  licensePlate: string | null;
  driverProfileId: string | null;
  driverCode: string | null;
  driverName: string | null;
  plannedStartAt: string;
  dispatchedAt: string | null;
  closedAt: string | null;
  status: string;
  stopCount: string;
  deliveryOrderCount: string;
  attemptCount: string;
  deliveredFullCount: string;
  deliveredPartialCount: string;
  failedCount: string;
  rescheduledCount: string;
  onTimeEligibleFullCount: string;
  onTimeFullCount: string;
  lateFullCount: string;
  fullWithoutPlanCount: string;
  pendingResultCount: string;
  onTimeFullRatePercent: string | null;
  tripDurationMinutes: string | null;
}>;

export type LogisticsAttemptRow = Readonly<{
  attemptId: string;
  tripId: string;
  tripNumber: string;
  tripStopId: string;
  stopSequence: number | string;
  plannedArrivalAt: string | null;
  deliveryOrderId: string;
  deliveryOrderNumber: string | null;
  customerCodeSnapshot: string;
  customerNameSnapshot: string;
  driverProfileId: string;
  driverCode: string;
  driverName: string;
  result: 'delivered_full' | 'delivered_partial' | 'failed' | 'rescheduled';
  reasonCode: string | null;
  attemptedAt: string;
  rescheduledFor: string | null;
  onTime: boolean | null;
}>;

export type LogisticsExceptionRow = Readonly<{
  exceptionCode: 'MISSING_PLANNED_ARRIVAL' | 'PENDING_DELIVERY_RESULT';
  exceptionCount: string;
}>;

export type LogisticsDashboard = Readonly<{
  family: 'logistics';
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  filters: Readonly<{ from: string; to: string; warehouseId: string | null }>;
  scope: Readonly<{ warehouseIds: readonly string[] }>;
  basis: Readonly<{
    cohort: string;
    sla: string;
    slaCoverage: string;
    outcomes: string;
    utilization: string;
    reconciliation: string;
    drilldown: string;
    adminReuse: string;
  }>;
  summary: LogisticsSummary;
  statuses: readonly LogisticsStatusRow[];
  warehouses: readonly LogisticsWarehouseRow[];
  drivers: readonly LogisticsActorRow[];
  vehicles: readonly LogisticsActorRow[];
  failureReasons: readonly LogisticsFailureReasonRow[];
  trips: readonly LogisticsTripRow[];
  attempts: readonly LogisticsAttemptRow[];
  reconciliation: Readonly<{
    postedReturnReceiptCount?: string;
    tripsWithReturnReceiptCount?: string;
  }>;
  dataQuality: Readonly<{ exceptions: readonly LogisticsExceptionRow[] }>;
}>;