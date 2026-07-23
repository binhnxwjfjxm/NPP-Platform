import { createApiClient } from "@/lib/api/api-client";
import { accountsFromRouteCustomers } from "./accounts-from-route-customers";
import { OutletsClientPage } from "./OutletsClientPage";

export async function AccountsPage() {
  const api = createApiClient();
  const routeCustomersResult = await api.getRouteCustomersData();
  const accountsData = accountsFromRouteCustomers(routeCustomersResult.data);

  return <OutletsClientPage kpis={accountsData.kpis} items={accountsData.accounts} />;
}
