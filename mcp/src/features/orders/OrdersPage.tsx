import { loadOrdersResult } from "@/lib/api/orders-data";
import { loadRouteCustomersData } from "@/lib/api/routes-data";
import { OrdersClientPage } from "./OrdersClientPage";

const api = {
  getRouteCustomersData: loadRouteCustomersData
};

export async function OrdersPage() {
  const [ordersResult, routeCustomersData] = await Promise.all([
    loadOrdersResult(),
    api.getRouteCustomersData()
  ]);

  return (
    <OrdersClientPage
      ordersResult={ordersResult}
      customers={routeCustomersData.customers}
    />
  );
}
