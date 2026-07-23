export type RouteStatus = "active" | "watch" | "paused";

export type RouteItem = {
  id: string;
  name: string;
  area: string;
  salesOwner: string;
  plannedCustomers: number;
  visitedCustomers: number;
  orderCount: number;
  lastVisitDate: string;
  status: RouteStatus;
};

export type RouteKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type RoutesData = {
  kpis: RouteKpi[];
  routes: RouteItem[];
};
