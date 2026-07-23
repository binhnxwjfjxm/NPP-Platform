import "server-only";

import { accountsMock } from "@/features/accounts/accounts.mock";
import type { AccountsData } from "@/features/accounts/accounts.types";
import { actionsMock } from "@/features/actions/actions.mock";
import type { ActionsData } from "@/features/actions/actions.types";
import { marketChecksMock } from "@/features/market-checks/market-checks.mock";
import type { MarketChecksData } from "@/features/market-checks/market-checks.types";
import { mcpDayMock } from "@/features/mcp-day/mcp-day.mock";
import type { McpDayActionResult, McpDayAddCustomerPayload, McpDayData, McpDayFollowupPayload, McpDayResultPayload } from "@/features/mcp-day/mcp-day.types";
import { routeCustomersMock } from "@/features/mcp/route-customers.mock";
import type { RouteCustomersData } from "@/features/mcp/route-customers.types";
import { routesMock } from "@/features/routes/routes.mock";
import type { RoutesData } from "@/features/routes/routes.types";
import type { AccountDto, ActionDto, ApiResult, DashboardOverviewDto, DashboardSummaryDto, DayRunDto, ListQuery, MarketCheckDto, OrderDto, RouteDto } from "./api.types";
import { idempotentMutationFetch } from "./idempotent-fetch";

export type McpApiClient = {
  getDashboardSummary(): Promise<ApiResult<DashboardSummaryDto>>;
  getDashboardOverview(): Promise<ApiResult<DashboardOverviewDto>>;
  listRoutes(query?: ListQuery): Promise<ApiResult<RouteDto[]>>;
  getRoutesData(query?: ListQuery): Promise<ApiResult<RoutesData>>;
  getRouteCustomersData(query?: ListQuery): Promise<ApiResult<RouteCustomersData>>;
  listAccounts(query?: ListQuery): Promise<ApiResult<AccountDto[]>>;
  getAccountsData(query?: ListQuery): Promise<ApiResult<AccountsData>>;
  getCurrentDayRun(query?: ListQuery): Promise<ApiResult<DayRunDto>>;
  getMcpDayData(query?: ListQuery): Promise<ApiResult<McpDayData>>;
  createMcpDayResult(payload: McpDayResultPayload): Promise<ApiResult<McpDayActionResult>>;
  addMcpDayCustomer(payload: McpDayAddCustomerPayload): Promise<ApiResult<McpDayActionResult>>;
  createMcpDayFollowup(payload: McpDayFollowupPayload): Promise<ApiResult<McpDayActionResult>>;
  listMarketChecks(query?: ListQuery): Promise<ApiResult<MarketCheckDto[]>>;
  getMarketChecksData(query?: ListQuery): Promise<ApiResult<MarketChecksData>>;
  listOrders(query?: ListQuery): Promise<ApiResult<OrderDto[]>>;
  listActions(query?: ListQuery): Promise<ApiResult<ActionDto[]>>;
  getActionsData(query?: ListQuery): Promise<ApiResult<ActionsData>>;
};

type McpSessionStatusRow = {
  routeId?: string;
  sessionDate?: string;
  status?: string;
};

type McpSessionStatusData = {
  sessions?: McpSessionStatusRow[];
};

function result<T>(data: T, source: ApiResult<T>["source"] = "mock"): ApiResult<T> {
  return { data, source, receivedAt: new Date().toISOString() };
}

function toQueryString(query?: ListQuery): string {
  if (!query) return "";
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : "";
}

function getApiBaseUrl(): string | null {
  const value = (process.env.BACKEND_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

function getBackendApiToken(): string | null {
  const value = (process.env.BACKEND_API_TOKEN || "").trim();
  return value || null;
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function noMockInProductionError(message: string) {
  return new Error(`production_no_mock: ${message}`);
}

function backendHeaders(backendApiToken: string | null, json = false): Record<string, string> {
  return {
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(backendApiToken ? { "X-Backend-Token": backendApiToken } : {})
  };
}

function isNextDynamicUsageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const digest = typeof error === "object" && error ? String((error as { digest?: unknown }).digest ?? "") : "";
  return message.includes("Dynamic server usage") || message.includes("dynamic server usage") || digest.includes("DYNAMIC_SERVER_USAGE");
}

function hasRouteContext(query?: ListQuery) {
  return Boolean(query?.routeId || query?.route_id);
}

function getRouteId(query?: ListQuery) {
  return String(query?.routeId || query?.route_id || "").trim();
}

function getSessionDate(query?: ListQuery) {
  return String(query?.date || query?.sessionDate || query?.session_date || "").slice(0, 10);
}

function selectedRouteNotLoaded(query?: ListQuery): McpDayData {
  const routeId = getRouteId(query);
  const date = getSessionDate(query) || "-";
  return {
    sessionOpened: false,
    run: {
      id: "selected-route-not-loaded",
      routeId,
      routeName: "Không tải được phiên đã chọn",
      date,
      owner: "-",
      status: "cancelled",
      openedAt: "-"
    },
    kpis: [
      { label: "Trong phiên", value: 0, hint: "API chưa trả dữ liệu" },
      { label: "Đã ghé", value: 0, hint: "Không dùng mock" },
      { label: "Chờ xử lý", value: 0, hint: routeId || "Thiếu routeId" },
      { label: "Phát sinh", value: 0, hint: "Kiểm tra API env" }
    ],
    lines: [],
    results: []
  };
}

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  backendApiToken: string | null,
  query?: ListQuery
): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}${path}${toQueryString(query)}`, {
    cache: "no-store",
    headers: backendHeaders(backendApiToken)
  });
  if (!response.ok) throw new Error(`API ${path} failed with ${response.status}`);
  const payload = (await response.json()) as T | { data: T; receivedAt?: string };
  if (payload && typeof payload === "object" && "data" in payload) {
    const wrapped = payload as { data: T; receivedAt?: string };
    return { data: wrapped.data, source: "api", receivedAt: wrapped.receivedAt ?? new Date().toISOString() };
  }
  return result(payload as T, "api");
}

async function parseMutationResponse<T>(response: Response, path: string): Promise<ApiResult<T>> {
  const payload = (await response.json().catch(() => ({}))) as T | { data: T; receivedAt?: string; error?: { message?: string } | string; detail?: string };
  if (!response.ok) {
    const errorPayload = payload as { error?: { message?: string } | string; detail?: string };
    const message = typeof errorPayload.error === "string" ? errorPayload.error : errorPayload.error?.message;
    throw new Error(message || `API ${path} failed with ${response.status}`);
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    const wrapped = payload as { data: T; receivedAt?: string };
    return { data: wrapped.data, source: "api", receivedAt: wrapped.receivedAt ?? new Date().toISOString() };
  }
  return result(payload as T, "api");
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  backendApiToken: string | null,
  body: unknown
): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: backendHeaders(backendApiToken, true),
    body: JSON.stringify(body)
  });
  return parseMutationResponse<T>(response, path);
}

async function postIdempotentJson<T>(
  baseUrl: string,
  path: string,
  backendApiToken: string | null,
  body: unknown,
  operation: string
): Promise<ApiResult<T>> {
  const response = await idempotentMutationFetch(
    `${baseUrl}${path}`,
    {
      method: "POST",
      headers: backendHeaders(backendApiToken, true),
      body: JSON.stringify(body)
    },
    { operation }
  );
  return parseMutationResponse<T>(response, path);
}

function normalizeSessionStatus(value?: string) {
  if (value === "done" || value === "completed") return "done";
  if (value === "cancelled") return "cancelled";
  return "active";
}

async function getMcpDayDataWithSessionStatus(
  baseUrl: string,
  backendApiToken: string | null,
  query?: ListQuery
): Promise<ApiResult<McpDayData>> {
  const dayResult = await fetchJson<McpDayData>(baseUrl, "/api/mcp-day/data", backendApiToken, query);
  const routeId = getRouteId(query);
  const sessionDate = getSessionDate(query);

  if (!routeId || !sessionDate || !dayResult.data.sessionOpened) return dayResult;

  const statusResult = await fetchJson<McpSessionStatusData>(
    baseUrl,
    "/api/mcp-settings/session-status",
    backendApiToken,
    { routeId }
  );
  const session = statusResult.data.sessions?.find((item) => item.routeId === routeId && item.sessionDate === sessionDate);
  if (!session?.status) return dayResult;

  return {
    ...dayResult,
    data: {
      ...dayResult.data,
      run: {
        ...dayResult.data.run,
        status: normalizeSessionStatus(session.status)
      }
    }
  };
}

async function withMockFallback<T>(apiRequest: () => Promise<ApiResult<T>>, mockRequest: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
  try {
    return await apiRequest();
  } catch (error) {
    if (isNextDynamicUsageError(error)) throw error;
    if (isProductionRuntime()) {
      const detail = error instanceof Error ? error.message : "api_failed";
      throw noMockInProductionError(detail);
    }
    return mockRequest();
  }
}

export const mockApiClient: McpApiClient = {
  async getDashboardSummary() { return result({ routeCount: 8, accountCount: 51, visitCount: 73, orderAmount: 403000, actionCount: 9 }); },
  async getDashboardOverview() { return result({ kpis: [{ label: "Doanh số hôm nay", value: "403K", hint: "Từ API client", trend: "+12%" }, { label: "Tuyến active", value: 8, hint: "Đang mở", trend: "Ổn định" }, { label: "Điểm bán", value: 51, hint: "Trong tuyến", trend: "+4 cần chăm sóc" }, { label: "Lượt ghé", value: 73, hint: "Đã ghi nhận", trend: "72 hoàn thành" }], routeHealth: [{ routeName: "Tuyến trung tâm", area: "Chợ Gạo", planned: 18, visited: 17, orders: 2, status: "good" }, { routeName: "Tuyến phía Đông", area: "Mỹ Tho", planned: 14, visited: 11, orders: 0, status: "watch" }, { routeName: "Tuyến ven sông", area: "Gò Công", planned: 12, visited: 7, orders: 0, status: "risk" }], actions: [{ title: "Ghé lại nhóm khách chưa có đơn", description: "Ưu tiên điểm bán đã ghé nhưng chưa có đơn.", priority: "high", owner: "Sale" }, { title: "Kiểm tra tuyến ven sông", description: "Tỷ lệ ghé thấp hơn kế hoạch.", priority: "medium", owner: "Giám sát" }], insights: [{ label: "Tỷ lệ ghé thăm", value: "88%" }, { label: "Tỷ lệ có đơn", value: "2.7%" }, { label: "SKU đang test", value: "33" }, { label: "Nguồn", value: "API client" }] }); },
  async listRoutes() { return result([{ id: "route-001", name: "Tuyến Chợ Gạo", area: "Chợ Gạo", owner: "Sale A", active: true }, { id: "route-002", name: "Tuyến Mỹ Tho", area: "Mỹ Tho", owner: "Sale B", active: true }]); },
  async getRoutesData() { return result(routesMock); },
  async getRouteCustomersData() { return result(routeCustomersMock); },
  async listAccounts() { return result([{ id: "acc-001", name: "Điểm bán Minh Châu", area: "Chợ Gạo", routeName: "Tuyến Chợ Gạo", tier: "A" }, { id: "acc-002", name: "Điểm bán Thành Phát", area: "Chợ Gạo", routeName: "Tuyến Chợ Gạo", tier: "B" }]); },
  async getAccountsData() { return result(accountsMock); },
  async getCurrentDayRun() { return result({ id: "day-001", routeName: "Tuyến Chợ Gạo", date: "2026-07-03", owner: "Sale A", status: "opened" }); },
  async getMcpDayData(query) { return result(hasRouteContext(query) ? selectedRouteNotLoaded(query) : mcpDayMock); },
  async createMcpDayResult(payload) { return result({ payload, mock: true }); },
  async addMcpDayCustomer(payload) { return result({ payload, mock: true }); },
  async createMcpDayFollowup(payload) { return result({ payload, mock: true }); },
  async listMarketChecks() { return result([{ id: "check-001", date: "2026-07-03", routeName: "Tuyến Chợ Gạo", accountName: "Điểm bán Minh Châu", productName: "Sữa hộp 180ml", status: "opportunity" }]); },
  async getMarketChecksData() { return result(marketChecksMock); },
  async listOrders() { return result([{ id: "order-001", code: "DH-0001", date: "2026-07-03", accountName: "Điểm bán Minh Châu", routeName: "Tuyến Chợ Gạo", owner: "Sale A", source: "Phiên MCP", skuCount: 4, quantity: 36, totalAmount: 2450000, status: "confirmed" }, { id: "order-002", code: "DH-0002", date: "2026-07-03", accountName: "Điểm bán Thành Phát", routeName: "Tuyến Chợ Gạo", owner: "Sale A", source: "Kết quả ghé", skuCount: 3, quantity: 24, totalAmount: 1780000, status: "delivered" }, { id: "order-003", code: "DH-0003", date: "2026-07-02", accountName: "Điểm bán Tân Lợi", routeName: "Tuyến Cái Bè", owner: "Sale B", source: "Điện thoại", skuCount: 5, quantity: 42, totalAmount: 3150000, status: "confirmed" }]); },
  async listActions() { return result([{ id: "act-001", title: "Ghé lại điểm bán đóng cửa", owner: "Sale C", priority: "high", status: "todo", dueDate: "2026-07-04" }]); },
  async getActionsData() { return result(actionsMock); }
};

function createHttpApiClient(baseUrl: string, backendApiToken: string | null): McpApiClient {
  return {
    getDashboardSummary() { return withMockFallback(() => fetchJson<DashboardSummaryDto>(baseUrl, "/api/dashboard/summary", backendApiToken), () => mockApiClient.getDashboardSummary()); },
    getDashboardOverview() { return withMockFallback(() => fetchJson<DashboardOverviewDto>(baseUrl, "/api/dashboard/overview", backendApiToken), () => mockApiClient.getDashboardOverview()); },
    listRoutes(query) { return withMockFallback(() => fetchJson<RouteDto[]>(baseUrl, "/api/routes", backendApiToken, query), () => mockApiClient.listRoutes(query)); },
    getRoutesData(query) { return withMockFallback(() => fetchJson<RoutesData>(baseUrl, "/api/routes/data", backendApiToken, query), () => mockApiClient.getRoutesData(query)); },
    getRouteCustomersData(query) { return withMockFallback(() => fetchJson<RouteCustomersData>(baseUrl, "/api/routes/customers/data", backendApiToken, query), () => mockApiClient.getRouteCustomersData(query)); },
    listAccounts(query) { return withMockFallback(() => fetchJson<AccountDto[]>(baseUrl, "/api/accounts", backendApiToken, query), () => mockApiClient.listAccounts(query)); },
    getAccountsData(query) { return withMockFallback(() => fetchJson<AccountsData>(baseUrl, "/api/accounts/data", backendApiToken, query), () => mockApiClient.getAccountsData(query)); },
    getCurrentDayRun(query) { return withMockFallback(() => fetchJson<DayRunDto>(baseUrl, "/api/mcp-day/current", backendApiToken, query), () => mockApiClient.getCurrentDayRun(query)); },
    getMcpDayData(query) {
      if (hasRouteContext(query)) return getMcpDayDataWithSessionStatus(baseUrl, backendApiToken, query);
      return withMockFallback(() => getMcpDayDataWithSessionStatus(baseUrl, backendApiToken, query), () => mockApiClient.getMcpDayData(query));
    },
    createMcpDayResult(payload) { return postIdempotentJson<McpDayActionResult>(baseUrl, "/api/mcp-day/session-customer/result", backendApiToken, payload, "session-customer.result.record"); },
    addMcpDayCustomer(payload) { return postIdempotentJson<McpDayActionResult>(baseUrl, "/api/mcp-day/session-customer/add", backendApiToken, payload, "session-customer.add"); },
    createMcpDayFollowup(payload) { return postJson<McpDayActionResult>(baseUrl, "/api/mcp-day/session-customer/followup", backendApiToken, payload); },
    listMarketChecks(query) { return withMockFallback(() => fetchJson<MarketCheckDto[]>(baseUrl, "/api/market-checks", backendApiToken, query), () => mockApiClient.listMarketChecks(query)); },
    getMarketChecksData(query) { return withMockFallback(() => fetchJson<MarketChecksData>(baseUrl, "/api/market-checks/data", backendApiToken, query), () => mockApiClient.getMarketChecksData(query)); },
    listOrders(query) { return withMockFallback(() => fetchJson<OrderDto[]>(baseUrl, "/api/orders", backendApiToken, query), () => mockApiClient.listOrders(query)); },
    listActions(query) { return withMockFallback(() => fetchJson<ActionDto[]>(baseUrl, "/api/actions", backendApiToken, query), () => mockApiClient.listActions(query)); },
    getActionsData(query) { return withMockFallback(() => fetchJson<ActionsData>(baseUrl, "/api/actions/data", backendApiToken, query), () => mockApiClient.getActionsData(query)); }
  };
}

export function createApiClient(): McpApiClient {
  const apiBaseUrl = getApiBaseUrl();
  const backendApiToken = getBackendApiToken();

  if (!apiBaseUrl) {
    if (isProductionRuntime()) throw noMockInProductionError("missing_backend_api_base_url");
    return mockApiClient;
  }
  if (!backendApiToken && isProductionRuntime()) {
    throw noMockInProductionError("missing_backend_api_token");
  }

  return createHttpApiClient(apiBaseUrl, backendApiToken);
}
