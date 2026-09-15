"use client";

import type { ApiResult, OrderDto } from "@/lib/api/api.types";
import { useMcpLocalResource } from "@/lib/local-read/use-mcp-local-resource";
import { useMcpShellSnapshot } from "@/lib/local-read/use-mcp-shell";
import { OrdersClientPage } from "./OrdersClientPage";

const EMPTY_ORDERS: ApiResult<OrderDto[]> = { data: [], source: "api", receivedAt: "" };

export function OrdersLocalPage() {
  const read = useMcpLocalResource<ApiResult<OrderDto[]>>("orders");
  const shell = useMcpShellSnapshot();
  return <OrdersClientPage ordersResult={read.data ?? EMPTY_ORDERS} customers={shell.snapshot?.routeCustomersData.customers ?? []} />;
}
