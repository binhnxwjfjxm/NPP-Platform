export type DashboardKpi = {
  label: string;
  value: string | number;
  hint: string;
  trend: string;
};

export type DashboardRouteHealth = {
  routeName: string;
  area: string;
  planned: number;
  visited: number;
  orders: number;
  status: "good" | "watch" | "risk";
};

export type DashboardAction = {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  owner: string;
};

export type DashboardInsight = {
  label: string;
  value: string;
};

export type DashboardData = {
  kpis: DashboardKpi[];
  routeHealth: DashboardRouteHealth[];
  actions: DashboardAction[];
  insights: DashboardInsight[];
};
