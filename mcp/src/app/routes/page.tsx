import { MCPPage } from "@/features/mcp/MCPPage";
import { createApiClient } from "@/lib/api/api-client";
import { isInternalSmokeRecord, visibleRouteIds, withoutInternalSmokeRows } from "@/lib/data/internal-smoke";

export default async function Page() {
  const api = createApiClient();
  const [routesResult, routeCustomersResult] = await Promise.all([
    api.getRoutesData(),
    api.getRouteCustomersData()
  ]);
  const routes = withoutInternalSmokeRows(routesResult.data.routes);
  const routeIds = visibleRouteIds(routes);
  const customers = routeCustomersResult.data.customers.filter((customer) => (
    routeIds.has(customer.routeId) && !isInternalSmokeRecord(customer)
  ));

  return (
    <MCPPage
      activeHref="/routes"
      routesData={{ ...routesResult.data, routes }}
      routeCustomersData={{ ...routeCustomersResult.data, customers }}
    />
  );
}
