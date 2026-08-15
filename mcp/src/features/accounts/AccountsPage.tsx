import {
  loadOwnedCoreCustomers,
  loadOwnedRouteCustomersData
} from "@/lib/api/customer-onboarding-data";
import { accountsFromRouteCustomers } from "./accounts-from-route-customers";
import { OutletsClientPage } from "./OutletsClientPage";

export async function AccountsPage() {
  const [routeCustomersData, coreCustomers] = await Promise.all([
    loadOwnedRouteCustomersData(),
    loadOwnedCoreCustomers()
  ]);
  const outletsData = accountsFromRouteCustomers(routeCustomersData);

  return (
    <OutletsClientPage
      kpis={outletsData.kpis}
      items={outletsData.outlets}
      coreCustomers={coreCustomers}
    />
  );
}
