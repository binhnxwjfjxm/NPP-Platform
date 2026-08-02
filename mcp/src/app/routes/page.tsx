import { MCPPage } from "@/features/mcp/MCPPage";
import { loadRouteCustomersData, loadRoutesData } from "@/lib/api/routes-data";
import { isInternalSmokeRecord, visibleRouteIds, withoutInternalSmokeRows } from "@/lib/data/internal-smoke";

export default async function Page() {
  const [routesData, routeCustomersData] = await Promise.all([
    loadRoutesData(),
    loadRouteCustomersData()
  ]);
  const routes = withoutInternalSmokeRows(routesData.routes);
  const routeIds = visibleRouteIds(routes);
  const customers = routeCustomersData.customers.filter((customer) => (
    routeIds.has(customer.routeId) && !isInternalSmokeRecord(customer)
  ));

  return (
    <MCPPage
      activeHref="/routes"
      routesData={{ ...routesData, routes }}
      routeCustomersData={{ ...routeCustomersData, customers }}
    />
  );
}
