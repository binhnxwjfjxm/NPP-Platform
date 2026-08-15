import { loadOrdersResult } from "@/lib/api/orders-data";
import { OrdersClientPage } from "./OrdersClientPage";

export async function OrdersPage() {
  const ordersResult = await loadOrdersResult();

  return (
    <OrdersClientPage
      ordersResult={ordersResult}
      customers={[]}
    />
  );
}
