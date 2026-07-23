import { createApiClient } from "@/lib/api/api-client";
import { OrdersClientPage } from "./OrdersClientPage";

export async function OrdersPage() {
  const api = createApiClient();
  const [ordersResult, routeCustomersResult] = await Promise.all([
    api.listOrders(),
    api.getRouteCustomersData()
  ]);

  return (
    <OrdersClientPage
      ordersResult={ordersResult}
      customers={routeCustomersResult.data.customers}
    />
  );
}
