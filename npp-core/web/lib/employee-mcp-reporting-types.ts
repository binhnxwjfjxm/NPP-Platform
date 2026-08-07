export type EmployeeMcpSummary = Readonly<{
  sessionCount?: string;
  routeCount?: string;
  plannedOutletCount?: string;
  plannedVisitedOutletCount?: string;
  visitedOutletCount?: string;
  checkedInOutletCount?: string;
  visitCount?: string;
  orderIntentCount?: string;
  onboardingSubmittedCount?: string;
  onboardingConvertedCount?: string;
  coreSalesOrderCount?: string;
  mappedEmployeeSessionCount?: string;
  unmappedEmployeeSessionCount?: string;
  counterMismatchSessionCount?: string;
  plannedVisitRatePercent?: string | null;
  orderIntentConversionPercent?: string | null;
  onboardingConversionPercent?: string | null;
  coreOrderConversionPercent?: string | null;
}>;

export type EmployeeMcpActorRow = Readonly<{
  salesLabel: string | null;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  sessionCount: string;
  routeCount: string;
  plannedOutletCount: string;
  plannedVisitedOutletCount: string;
  visitedOutletCount: string;
  checkedInOutletCount: string;
  visitCount: string;
  orderIntentCount: string;
  onboardingSubmittedCount: string;
  onboardingConvertedCount: string;
  coreSalesOrderCount: string;
  plannedVisitRatePercent: string | null;
  orderIntentConversionPercent: string | null;
  coreOrderConversionPercent: string | null;
}>;

export type EmployeeMcpRouteRow = Readonly<{
  routeId: string;
  routeCode: string | null;
  routeName: string;
  area: string | null;
  salesLabel: string | null;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  sessionCount: string;
  plannedOutletCount: string;
  plannedVisitedOutletCount: string;
  visitedOutletCount: string;
  checkedInOutletCount: string;
  orderIntentCount: string;
  coreSalesOrderCount: string;
  plannedVisitRatePercent: string | null;
}>;

export type EmployeeMcpSessionRow = Readonly<{
  sessionId: string;
  sessionDate: string;
  routeId: string;
  routeCode: string | null;
  routeName: string;
  area: string | null;
  salesLabel: string | null;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  status: string;
  plannedOutletCount: string;
  plannedVisitedOutletCount: string;
  visitedOutletCount: string;
  checkedInOutletCount: string;
  visitCount: string;
  orderIntentCount: string;
  onboardingSubmittedCount: string;
  onboardingConvertedCount: string;
  coreSalesOrderCount: string;
  storedCounterMismatch: boolean;
  openedAt: string | null;
  closedAt: string | null;
}>;

export type EmployeeMcpUnmappedActor = Readonly<{
  exceptionCode: 'MISSING_FIELD_ACTOR_CODE' | 'UNMAPPED_EMPLOYEE_CODE';
  salesLabel: string | null;
  sessionCount: string;
  firstSessionDate: string;
  lastSessionDate: string;
}>;

export type EmployeeMcpCounterMismatch = Readonly<{
  exceptionCode: 'SESSION_COUNTER_MISMATCH';
  sessionId: string;
  sessionDate: string;
  routeId: string;
  routeCode: string | null;
  routeName: string;
  salesLabel: string | null;
  storedPlannedCustomers: string;
  derivedPlannedOutletCount: string;
  storedVisitedCustomers: string;
  derivedVisitedOutletCount: string;
  storedOrderCount: string;
  derivedOrderIntentCount: string;
}>;

export type EmployeeMcpDashboard = Readonly<{
  family: 'employee-mcp';
  generatedAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  filters: Readonly<{ from: string; to: string }>;
  scope: Readonly<{
    basis: 'INSTALLATION' | 'EMPLOYEE_CODE';
    employeeId: string | null;
    employeeCode: string | null;
  }>;
  basis: Readonly<{
    identity: string;
    territory: string;
    visits: string;
    conversion: string;
    customerBoundary: string;
    adminReuse: string;
  }>;
  summary: EmployeeMcpSummary;
  fieldActors: readonly EmployeeMcpActorRow[];
  routes: readonly EmployeeMcpRouteRow[];
  sessions: readonly EmployeeMcpSessionRow[];
  dataQuality: Readonly<{
    unmappedActors: readonly EmployeeMcpUnmappedActor[];
    counterMismatches: readonly EmployeeMcpCounterMismatch[];
  }>;
}>;
