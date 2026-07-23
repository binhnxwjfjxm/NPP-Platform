export type MarketCheckStatus = "normal" | "opportunity" | "risk";

export type MarketCheckItem = {
  id: string;
  fileId: string;
  customerId: string;
  resultId?: string;
  productId?: string;
  sessionId?: string;
  sessionCustomerId?: string;
  routeId?: string;
  sessionDate?: string;
  date: string;
  routeName: string;
  accountName: string;
  phone?: string;
  area?: string;
  productName: string;
  competitorName: string;
  shelfPrice: number;
  stockStatus: string;
  note: string;
  status: MarketCheckStatus;
};

export type MarketCheckSessionGroup = {
  id: string;
  sessionId: string;
  routeId: string;
  routeName: string;
  sessionDate: string;
  sales?: string;
  status: string;
  plannedCustomers: number;
  visitedCustomers: number;
  customerCount: number;
  resultCount: number;
  pendingCount: number;
  opportunityCount: number;
  riskCount: number;
  items: MarketCheckItem[];
};

export type MarketCheckKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type MarketChecksData = {
  kpis: MarketCheckKpi[];
  checks: MarketCheckItem[];
  groups?: MarketCheckSessionGroup[];
};
