import { loadOwnedCoreCustomers } from "@/lib/api/customer-onboarding-data";
import { loadRouteCustomersData } from "@/lib/api/routes-data";
import { accountsFromRouteCustomers } from "./accounts-from-route-customers";
import { OutletsClientPage } from "./OutletsClientPage";

export async function AccountsPage() {
  const [routeCustomersData, coreCustomers] = await Promise.all([
    loadRouteCustomersData(),
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
