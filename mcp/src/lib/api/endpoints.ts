export const API_ENDPOINTS = {
  dashboardSummary: "/api/dashboard/summary",
  routes: "/api/routes",
  accounts: "/api/accounts",
  dayRun: "/api/mcp/day-run",
  marketChecks: "/api/field-checks",
  orders: "/api/orders",
  actions: "/api/actions"
} as const;

export type ApiEndpointKey = keyof typeof API_ENDPOINTS;
