import type { OrderDto } from "@/lib/api/api.types";
import {
  loadCustomerOnboardingQueue,
  loadOwnedCoreSalesOrders,
  type CoreSalesOrderItem,
  type CoreSalesOrderVersionItem
} from "@/lib/api/customer-onboarding-data";
import { loadOrdersResult } from "@/lib/api/orders-data";
import { OrdersClientPage } from "./OrdersClientPage";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOr(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value: unknown) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "";
}

function currentVersion(order: CoreSalesOrderItem): CoreSalesOrderVersionItem | null {
  const versions = Array.isArray(order.versions) ? order.versions : [];
  const current = text(order.currentVersionNumber);
  return versions.find((version) => text(version.versionNumber) === current) || versions[0] || null;
}

function coreOrderDto(order: CoreSalesOrderItem, routeNames: Map<string, string>): OrderDto | null {
  const id = text(order.id);
  if (!id) return null;
  const version = currentVersion(order);
  const lines = Array.isArray(version?.lines) ? version.lines : [];
  return {
    id,
    code: text(order.number) || id,
    date: dateOnly(order.createdAt || version?.createdAt || order.updatedAt),
    accountName: text(order.customerName || order.customerCode) || "Khách chưa tên",
    routeName: routeNames.get(text(order.sourceOutletId)) || "MCP",
    owner: "MCP",
    source: text(order.sourceType) || "MCP",
    skuCount: lines.length,
    quantity: lines.reduce((sum, line) => sum + numberOr(line.quantity), 0),
    totalAmount: numberOr(version?.total),
    status: text(order.status) || "draft"
  };
}

export async function OrdersPage() {
  const [legacyOrdersResult, coreOrders, customerQueue] = await Promise.all([
    loadOrdersResult(),
    loadOwnedCoreSalesOrders(),
    loadCustomerOnboardingQueue()
  ]);
  const routeNames = new Map(
    customerQueue.map((item) => [item.routeCustomerId, item.routeName || "MCP"])
  );
  const canonicalCoreOrders = coreOrders
    .map((order) => coreOrderDto(order, routeNames))
    .filter((order): order is OrderDto => Boolean(order));
  const coreIds = new Set(canonicalCoreOrders.map((order) => order.id));
  const coreCodes = new Set(canonicalCoreOrders.map((order) => order.code));
  const mergedOrders = [
    ...canonicalCoreOrders,
    ...legacyOrdersResult.data.filter((order) => !coreIds.has(order.id) && !coreCodes.has(order.code))
  ].sort((left, right) => {
    const dateCompare = right.date.localeCompare(left.date);
    return dateCompare || right.code.localeCompare(left.code, "vi");
  });

  return (
    <OrdersClientPage
      ordersResult={{
        ...legacyOrdersResult,
        data: mergedOrders,
        receivedAt: new Date().toISOString()
      }}
      customers={[]}
    />
  );
}
