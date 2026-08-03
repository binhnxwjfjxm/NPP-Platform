import { loadRouteCustomersData } from "@/lib/api/routes-data";
import { accountsFromRouteCustomers } from "./accounts-from-route-customers";
import { OutletsClientPage } from "./OutletsClientPage";

export async function AccountsPage() {
  const routeCustomersData = await loadRouteCustomersData();
  const accountsData = accountsFromRouteCustomers(routeCustomersData);

  return <OutletsClientPage kpis={accountsData.kpis} items={accountsData.accounts} />;
}
