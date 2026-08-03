import { loadOrdersResult } from "@/lib/api/orders-data";
import { loadRouteCustomersData } from "@/lib/api/routes-data";
import { OrdersClientPage } from "./OrdersClientPage";

export async function OrdersPage() {
  const [ordersResult, routeCustomersData] = await Promise.all([
    loadOrdersResult(),
    loadRouteCustomersData()
  ]);

  return (
    <OrdersClientPage
      ordersResult={ordersResult}
      customers={routeCustomersData.customers}
    />
  );
}
