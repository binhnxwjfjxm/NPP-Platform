export type ApiResult<T> = {
  data: T;
  source: "mock" | "api";
  receivedAt: string;
};

export type ListQuery = {
  dateFrom?: string;
  dateTo?: string;
  date?: string;
  sessionDate?: string;
  session_date?: string;
  routeId?: string;
  route_id?: string;
  ownerId?: string;
  status?: string;
  search?: string;
};

export type DashboardSummaryDto = {
  routeCount: number;
  accountCount: number;
  visitCount: number;
  orderAmount: number;
  actionCount: number;
};

export type DashboardKpiDto = {
  label: string;
  value: string | number;
  hint: string;
  trend: string;
};

export type DashboardRouteHealthDto = {
  routeName: string;
  area: string;
  planned: number;
  visited: number;
  orders: number;
  status: "good" | "watch" | "risk";
};

export type DashboardActionDto = {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  owner: string;
};

export type DashboardInsightDto = {
  label: string;
  value: string;
};

export type DashboardOverviewDto = {
  kpis: DashboardKpiDto[];
  routeHealth: DashboardRouteHealthDto[];
  actions: DashboardActionDto[];
  insights: DashboardInsightDto[];
};

export type RouteDto = {
  id: string;
  name: string;
  area: string;
  owner: string;
  active: boolean;
};

export type AccountDto = {
  id: string;
  name: string;
  area: string;
  routeName: string;
  tier: string;
};

export type DayRunDto = {
  id: string;
  routeName: string;
  date: string;
  owner: string;
  status: string;
};

export type MarketCheckDto = {
  id: string;
  date: string;
  routeName: string;
  accountName: string;
  productName: string;
  status: string;
};

export type OrderDto = {
  id: string;
  code: string;
  date: string;
  accountName: string;
  routeName: string;
  owner: string;
  source: string;
  skuCount: number;
  quantity: number;
  totalAmount: number;
  status: string;
};

export type OrderItemDto = {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  note: string | null;
};

export type OrderDetailDto = OrderDto & {
  customerPhone: string | null;
  area: string | null;
  deliveryAddress: string | null;
  subtotal: number;
  discountTotal: number;
  note: string | null;
  items: OrderItemDto[];
};

export type ActionDto = {
  id: string;
  title: string;
  owner: string;
  priority: string;
  status: string;
  dueDate: string;
};
