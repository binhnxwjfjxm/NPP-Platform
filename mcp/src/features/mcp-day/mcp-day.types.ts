export type DayRunStatus = "active" | "done" | "cancelled" | "opened" | "completed";

export type DayLineSource = "planned" | "added" | "synced";

export type DayLineStatus = "pending" | "visited" | "skipped" | "cancelled";

export type McpDayRun = {
  id: string;
  routeId?: string;
  routeName: string;
  date: string;
  owner: string;
  status: DayRunStatus;
  openedAt: string;
};

export type McpDayLine = {
  id: string;
  sessionCustomerId?: string;
  routeCustomerId?: string | null;
  sortOrder: number;
  accountName: string;
  area: string;
  source: DayLineSource;
  status: DayLineStatus;
  note: string;
  result?: string;
  orderId?: string;
  testId?: string;
  reportId?: string;
  hasOrder: boolean;
  hasTest?: boolean;
  hasReport?: boolean;
  followupCount?: number;
  visitId?: string;
  checkedIn?: boolean;
  checkinAt?: string;
  checkinLat?: number;
  checkinLng?: number;
  checkinAccuracy?: number;
  checkinSource?: string;
};

export type McpDayResult = {
  id: string;
  lineId: string;
  sessionCustomerId?: string;
  routeCustomerId?: string | null;
  accountName: string;
  startTime: string;
  endTime: string;
  result: string;
  orderId?: string;
  testId?: string;
  reportId?: string;
  hasOrder: boolean;
  hasTest?: boolean;
  hasReport?: boolean;
  followupCount?: number;
  nextAction: string;
};

export type McpDayKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type McpDayData = {
  sessionOpened?: boolean;
  run: McpDayRun;
  kpis: McpDayKpi[];
  lines: McpDayLine[];
  results: McpDayResult[];
};

export type McpOpenSessionPayload = {
  routeId: string;
  sessionDate: string;
  owner?: string;
};

export type McpOpenSessionResult = {
  session: Record<string, unknown>;
  createdSession: boolean;
  insertedSnapshotCount: number;
  snapshotCount: number;
};

export type McpDayResultPayload = {
  sessionCustomerId: string;
  resultType: "order" | "test" | "report";
  note?: string;
  hasOrder?: boolean;
  hasTest?: boolean;
  hasReport?: boolean;
};

export type McpDayAddCustomerPayload = {
  sessionId?: string;
  customerName: string;
  phone?: string;
  area?: string;
  address?: string;
  note?: string;
  geoLat?: number;
  geoLng?: number;
  geoAccuracy?: number;
  geoSource?: string;
  googleMapsUrl?: string;
};

export type McpDayFollowupPayload = {
  sessionCustomerId: string;
  title: string;
  followupType?: "general" | "order" | "test" | "report" | "debt" | "support";
  priority?: "low" | "medium" | "high";
  dueDate?: string;
  owner?: string;
  note?: string;
};

export type McpDayActionResult = Record<string, unknown>;
