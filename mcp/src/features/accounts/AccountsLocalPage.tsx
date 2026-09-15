"use client";

import type { CoreCustomerItem } from "@/lib/api/customer-onboarding-data";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import { useMcpLocalResource } from "@/lib/local-read/use-mcp-local-resource";
import { accountsFromRouteCustomers } from "./accounts-from-route-customers";
import { OutletsClientPage } from "./OutletsClientPage";

export function AccountsLocalPage() {
  const shell = useMcpShellSnapshot();
  const customers = useMcpLocalResource<CoreCustomerItem[]>("customers");
  const routeCustomersData = shell.snapshot?.routeCustomersData ?? { kpis: [], customers: [] };
  const outletsData = accountsFromRouteCustomers(routeCustomersData);
  return <OutletsClientPage kpis={outletsData.kpis} items={outletsData.outlets} coreCustomers={customers.data ?? []} />;
}
