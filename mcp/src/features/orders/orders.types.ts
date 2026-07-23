export type OrderStatus = "draft" | "confirmed" | "delivered" | "cancelled";

export type OrderItem = {
  id: string;
  code: string;
  date: string;
  accountName: string;
  routeName: string;
  owner: string;
  source: string;
  skuCount: number;
  quantity: number;
  totalAmount: number;
  status: OrderStatus;
};

export type OrderKpi = {
  label: string;
  value: string | number;
  hint: string;
};

export type OrdersData = {
  kpis: OrderKpi[];
  orders: OrderItem[];
};
