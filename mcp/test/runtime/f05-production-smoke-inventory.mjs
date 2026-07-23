export const SMOKE_PREFIX = "__NPP_F05_RUNTIME_SMOKE__";
export const SMOKE_SESSION_DATE = "2099-12-28";

export const MUTATION_INVENTORY = Object.freeze([
  { name: "standaloneOrderCreate", operation: "order.create", method: "POST", path: "/api/orders" },
  { name: "routeCreate", operation: "route.create", method: "POST", path: "/api/routes" },
  { name: "routeUpdate", operation: "route.update", method: "PATCH", path: "/api/routes/:routeId" },
  { name: "sessionOpen", operation: "route-session.open", method: "POST", path: "/api/mcp-day/open-session" },
  { name: "sessionCustomerStatus", operation: "session-customer.status.update", method: "POST", path: "/api/mcp-day/session-customer/status" },
  { name: "sessionUpdateClose", operation: "route-session.update", method: "PATCH", path: "/api/mcp-sessions/:sessionId" },
  { name: "sessionDeleteEmpty", operation: "route-session.delete-empty", method: "DELETE", path: "/api/mcp-sessions/:sessionId" },
  { name: "routeCustomerUpdate", operation: "route-customer.update", method: "PATCH", path: "/api/route-customers/:routeCustomerId" },
  { name: "routeCustomerArchive", operation: "route-customer.archive", method: "POST", path: "/api/route-customers/:routeCustomerId/archive", archive: true },
  { name: "routeArchive", operation: "route.archive", method: "POST", path: "/api/routes/:routeId/archive", archive: true }
]);

export const RETIRED_SETTINGS_POSTS = Object.freeze([
  "order-template", "test-template", "report-template", "followup-template",
  "skip-reason-template", "customer-add-rule", "session-status"
].map((name) => `/api/mcp-settings/${name}`));
