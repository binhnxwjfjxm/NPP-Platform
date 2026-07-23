import type { OrderDto } from "@/lib/api/api.types";

export type OrderPeriod = "7d" | "30d" | "90d" | "all";
export type OrderAttention = "all" | "pending" | "stale" | "possible_duplicate" | "cancelled";

export type OrderFilters = {
  period: OrderPeriod;
  search: string;
  routeName: string;
  owner: string;
  source: string;
  status: string;
  customer: string;
  attention: OrderAttention;
};

export type OrderBreakdownRow = {
  key: string;
  label: string;
  amount: number;
  orders: number;
  customers: number;
  quantity: number;
  skuCount: number;
  averageOrder: number;
  share: number;
};

export type OrderDailyRow = {
  date: string;
  amount: number;
  orders: number;
  customers: number;
};

export type OrderAlert = {
  key: "stale" | "possible_duplicate" | "draft" | "cancelled" | "zero_value" | "concentration";
  title: string;
  description: string;
  count: number;
  tone: "high" | "medium" | "low";
  attention?: OrderAttention;
  customer?: string;
};

export type OrderAnalytics = {
  summary: {
    totalAmount: number;
    orderCount: number;
    customerCount: number;
    routeCount: number;
    totalQuantity: number;
    totalSkuCount: number;
    averageOrder: number;
    revenuePerCustomer: number;
    averageSkuPerOrder: number;
    averageQuantityPerOrder: number;
    openOrders: number;
    deliveredRate: number;
    cancelledRate: number;
  };
  daily: OrderDailyRow[];
  customers: OrderBreakdownRow[];
  routes: OrderBreakdownRow[];
  owners: OrderBreakdownRow[];
  sources: OrderBreakdownRow[];
  statuses: OrderBreakdownRow[];
  alerts: OrderAlert[];
  possibleDuplicateIds: Set<string>;
  latestDate: string | null;
};

const DAY_MS = 86_400_000;

export const DEFAULT_ORDER_FILTERS: OrderFilters = {
  period: "30d",
  search: "",
  routeName: "",
  owner: "",
  source: "",
  status: "",
  customer: "",
  attention: "all"
};

export function normalizeOrderText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function safeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function orderDay(date: string) {
  const value = String(date || "").slice(0, 10);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / DAY_MS) : null;
}

export function latestOrderDate(orders: OrderDto[]) {
  const dates = orders.map((order) => String(order.date || "").slice(0, 10)).filter((date) => orderDay(date) !== null).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function periodDays(period: OrderPeriod) {
  if (period === "7d") return 7;
  if (period === "30d") return 30;
  if (period === "90d") return 90;
  return null;
}

function isWithinPeriod(order: OrderDto, period: OrderPeriod, latestDate: string | null) {
  const days = periodDays(period);
  if (!days || !latestDate) return true;
  const latest = orderDay(latestDate);
  const current = orderDay(order.date);
  if (latest === null || current === null) return true;
  return current >= latest - (days - 1) && current <= latest;
}

function isPending(order: OrderDto) {
  return order.status === "draft";
}

function isStale(order: OrderDto, latestDate: string | null) {
  if (!isPending(order) || !latestDate) return false;
  const latest = orderDay(latestDate);
  const current = orderDay(order.date);
  return latest !== null && current !== null && latest - current >= 3;
}

function duplicateFingerprint(order: OrderDto) {
  return [
    normalizeOrderText(order.accountName),
    String(order.date || "").slice(0, 10),
    safeNumber(order.totalAmount),
    safeNumber(order.quantity),
    safeNumber(order.skuCount)
  ].join("|");
}

export function possibleDuplicateOrderIds(orders: OrderDto[]) {
  const groups = new Map<string, OrderDto[]>();
  orders.forEach((order) => {
    const key = duplicateFingerprint(order);
    const current = groups.get(key) || [];
    current.push(order);
    groups.set(key, current);
  });
  const ids = new Set<string>();
  groups.forEach((group) => {
    if (group.length > 1) group.forEach((order) => ids.add(order.id));
  });
  return ids;
}

function attentionMatches(order: OrderDto, filters: OrderFilters, latestDate: string | null, duplicates: Set<string>) {
  if (filters.attention === "pending") return isPending(order);
  if (filters.attention === "stale") return isStale(order, latestDate);
  if (filters.attention === "possible_duplicate") return duplicates.has(order.id);
  if (filters.attention === "cancelled") return order.status === "cancelled";
  return true;
}

export function filterOrders(orders: OrderDto[], filters: OrderFilters) {
  const latestDate = latestOrderDate(orders);
  const duplicates = possibleDuplicateOrderIds(orders);
  const search = normalizeOrderText(filters.search);
  const customer = normalizeOrderText(filters.customer);

  return orders.filter((order) => {
    if (!isWithinPeriod(order, filters.period, latestDate)) return false;
    if (filters.routeName && order.routeName !== filters.routeName) return false;
    if (filters.owner && order.owner !== filters.owner) return false;
    if (filters.source && order.source !== filters.source) return false;
    if (filters.status && order.status !== filters.status) return false;
    if (customer && normalizeOrderText(order.accountName) !== customer) return false;
    if (!attentionMatches(order, filters, latestDate, duplicates)) return false;
    if (!search) return true;
    const haystack = normalizeOrderText([
      order.code,
      order.accountName,
      order.routeName,
      order.owner,
      order.source,
      order.status,
      order.totalAmount
    ].join(" "));
    return haystack.includes(search);
  });
}

type GroupAccumulator = {
  label: string;
  amount: number;
  orders: number;
  quantity: number;
  skuCount: number;
  customers: Set<string>;
};

function breakdown(orders: OrderDto[], selector: (order: OrderDto) => string, totalAmount: number) {
  const groups = new Map<string, GroupAccumulator>();
  orders.forEach((order) => {
    const label = selector(order).trim() || "Chưa xác định";
    const key = normalizeOrderText(label) || "unknown";
    const current = groups.get(key) || {
      label,
      amount: 0,
      orders: 0,
      quantity: 0,
      skuCount: 0,
      customers: new Set<string>()
    };
    current.amount += safeNumber(order.totalAmount);
    current.orders += 1;
    current.quantity += safeNumber(order.quantity);
    current.skuCount += safeNumber(order.skuCount);
    current.customers.add(normalizeOrderText(order.accountName) || order.id);
    groups.set(key, current);
  });

  return Array.from(groups.entries())
    .map(([key, group]): OrderBreakdownRow => ({
      key,
      label: group.label,
      amount: group.amount,
      orders: group.orders,
      customers: group.customers.size,
      quantity: group.quantity,
      skuCount: group.skuCount,
      averageOrder: group.orders ? group.amount / group.orders : 0,
      share: totalAmount ? group.amount / totalAmount : 0
    }))
    .sort((left, right) => right.amount - left.amount || right.orders - left.orders || left.label.localeCompare(right.label, "vi"));
}

function dailyBreakdown(orders: OrderDto[]) {
  const groups = new Map<string, { amount: number; orders: number; customers: Set<string> }>();
  orders.forEach((order) => {
    const date = String(order.date || "").slice(0, 10) || "Không ngày";
    const current = groups.get(date) || { amount: 0, orders: 0, customers: new Set<string>() };
    current.amount += safeNumber(order.totalAmount);
    current.orders += 1;
    current.customers.add(normalizeOrderText(order.accountName) || order.id);
    groups.set(date, current);
  });
  return Array.from(groups.entries())
    .map(([date, value]): OrderDailyRow => ({ date, amount: value.amount, orders: value.orders, customers: value.customers.size }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function buildAlerts(orders: OrderDto[], customers: OrderBreakdownRow[], latestDate: string | null, duplicates: Set<string>, totalAmount: number) {
  const alerts: OrderAlert[] = [];
  const staleCount = orders.filter((order) => isStale(order, latestDate)).length;
  const draftCount = orders.filter((order) => order.status === "draft").length;
  const cancelledCount = orders.filter((order) => order.status === "cancelled").length;
  const zeroValueCount = orders.filter((order) => safeNumber(order.totalAmount) <= 0).length;

  if (staleCount) alerts.push({
    key: "stale",
    title: "Đơn nháp tồn quá 3 ngày",
    description: "Đơn đã bắt đầu nhưng chưa được chốt sau ít nhất 3 ngày dữ liệu.",
    count: staleCount,
    tone: "high",
    attention: "stale"
  });
  if (duplicates.size) alerts.push({
    key: "possible_duplicate",
    title: "Đơn có dấu hiệu trùng",
    description: "Cùng khách, ngày, giá trị, số lượng và số SKU. Cần đối chiếu trước khi xử lý tiếp.",
    count: duplicates.size,
    tone: "high",
    attention: "possible_duplicate"
  });
  if (draftCount) alerts.push({
    key: "draft",
    title: "Đơn nháp chưa chốt",
    description: "Đơn đã bắt đầu nhưng chưa hoàn tất bước xác nhận.",
    count: draftCount,
    tone: "medium",
    attention: "pending"
  });
  if (cancelledCount) alerts.push({
    key: "cancelled",
    title: "Đơn đã hủy trong kỳ",
    description: "Theo dõi nguyên nhân hủy để tránh mất doanh số lặp lại.",
    count: cancelledCount,
    tone: "medium",
    attention: "cancelled"
  });
  if (zeroValueCount) alerts.push({
    key: "zero_value",
    title: "Đơn không có giá trị",
    description: "Đơn có tổng tiền bằng 0 cần được kiểm tra dữ liệu giá và số lượng.",
    count: zeroValueCount,
    tone: "high"
  });

  const topCustomer = customers[0];
  if (orders.length >= 3 && topCustomer && totalAmount > 0 && topCustomer.share >= 0.35) alerts.push({
    key: "concentration",
    title: "Doanh số phụ thuộc khách lớn",
    description: `${topCustomer.label} đang chiếm ${(topCustomer.share * 100).toFixed(0)}% doanh số đặt hàng trong bộ lọc.`,
    count: 1,
    tone: "low",
    customer: topCustomer.label
  });
  return alerts;
}

export function buildOrderAnalytics(orders: OrderDto[]): OrderAnalytics {
  const totalAmount = orders.reduce((sum, order) => sum + safeNumber(order.totalAmount), 0);
  const totalQuantity = orders.reduce((sum, order) => sum + safeNumber(order.quantity), 0);
  const totalSkuCount = orders.reduce((sum, order) => sum + safeNumber(order.skuCount), 0);
  const orderCount = orders.length;
  const customerCount = new Set(orders.map((order) => normalizeOrderText(order.accountName) || order.id)).size;
  const routeCount = new Set(orders.map((order) => normalizeOrderText(order.routeName)).filter(Boolean)).size;
  const deliveredCount = orders.filter((order) => order.status === "delivered").length;
  const cancelledCount = orders.filter((order) => order.status === "cancelled").length;
  const latestDate = latestOrderDate(orders);
  const possibleDuplicateIds = possibleDuplicateOrderIds(orders);
  const customers = breakdown(orders, (order) => order.accountName, totalAmount);

  return {
    summary: {
      totalAmount,
      orderCount,
      customerCount,
      routeCount,
      totalQuantity,
      totalSkuCount,
      averageOrder: orderCount ? totalAmount / orderCount : 0,
      revenuePerCustomer: customerCount ? totalAmount / customerCount : 0,
      averageSkuPerOrder: orderCount ? totalSkuCount / orderCount : 0,
      averageQuantityPerOrder: orderCount ? totalQuantity / orderCount : 0,
      openOrders: orders.filter(isPending).length,
      deliveredRate: orderCount ? deliveredCount / orderCount : 0,
      cancelledRate: orderCount ? cancelledCount / orderCount : 0
    },
    daily: dailyBreakdown(orders),
    customers,
    routes: breakdown(orders, (order) => order.routeName, totalAmount),
    owners: breakdown(orders, (order) => order.owner, totalAmount),
    sources: breakdown(orders, (order) => order.source, totalAmount),
    statuses: breakdown(orders, (order) => order.status, totalAmount),
    alerts: buildAlerts(orders, customers, latestDate, possibleDuplicateIds, totalAmount),
    possibleDuplicateIds,
    latestDate
  };
}

export function orderFilterOptions(orders: OrderDto[]) {
  const values = (selector: (order: OrderDto) => string) => Array.from(new Set(orders.map(selector).map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "vi"));
  return {
    routes: values((order) => order.routeName),
    owners: values((order) => order.owner),
    sources: values((order) => order.source),
    statuses: values((order) => order.status)
  };
}
