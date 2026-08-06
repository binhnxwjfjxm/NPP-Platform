import { loadRouteCustomersData } from "@/lib/api/routes-data";
import { accountsFromRouteCustomers } from "./accounts-from-route-customers";
import { OutletsClientPage } from "./OutletsClientPage";

export async function AccountsPage() {
  const routeCustomersData = await loadRouteCustomersData();
  const outletsData = accountsFromRouteCustomers(routeCustomersData);

  return <OutletsClientPage kpis={outletsData.kpis} items={outletsData.outlets} />;
}
