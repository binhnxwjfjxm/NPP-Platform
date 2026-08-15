import "server-only";

import { headers } from "next/headers";
import type { CustomerOnboardingQueueItem } from "@/features/accounts/customer-onboarding.types";
import type {
  RouteCustomerItem,
  RouteCustomerStatus,
  RouteCustomersData
} from "@/features/mcp/route-customers.types";
import { backendApiBaseUrl, backendApiRequestHeaders } from "@/lib/api/backend-proxy";
import { encodeMcpInternalAuthorization } from "@/lib/mcp-auth";
import { readMcpSessionToken, requestMcpInternalAuth } from "@/lib/internal-auth-client";

type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };

type WorkforceMePayload = Readonly<{
  employeeId?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
  scopes?: readonly string[] | Readonly<{ warehouseIds?: readonly string[] }>;
  session?: Readonly<{ loginName?: string; employeeFullName?: string; expiresAt?: string }>;
}>;

type RouteCustomerBoundaryItem = CustomerOnboardingQueueItem & Readonly<{
  customerId?: string | null;
  routeSales?: string | null;
  note?: string | null;
  sortOrder?: number | null;
  active?: boolean | null;
  geoLat?: number | null;
  geoLng?: number | null;
  geoAccuracy?: number | null;
  geoCapturedAt?: string | null;
}>;

const EMPLOYEE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function scopeList(value: WorkforceMePayload["scopes"]): string[] {
  if (Array.isArray(value)) return stringList(value);
  if (value && typeof value === "object" && "warehouseIds" in value) return stringList(value.warehouseIds);
  return [];
}

async function workforceAuthorizationFromSession(): Promise<string | null> {
  const token = readMcpSessionToken();
  if (!token) return null;

  const result = await requestMcpInternalAuth<WorkforceMePayload>("/api/internal-auth/me", {
    method: "GET",
    token
  });
  const employeeId = String(result.data?.employeeId || "").trim();
  const username = String(result.data?.session?.loginName || "").trim();
  const displayName = String(result.data?.session?.employeeFullName || "").trim();
  if (!result.ok || !result.data || !EMPLOYEE_UUID_PATTERN.test(employeeId) || !username || !displayName) {
    return null;
  }

  return encodeMcpInternalAuthorization({
    username,
    displayName,
    employeeId,
    roles: stringList(result.data.roles),
    permissions: stringList(result.data.permissions),
    scopes: scopeList(result.data.scopes),
    expiresAt: String(result.data.session?.expiresAt || "")
  });
}

async function trustedBackendGet<T>(path: string): Promise<T> {
  const incoming = headers();
  const authorization = incoming.get("authorization") || await workforceAuthorizationFromSession();
  const request = new Request("http://mcp.local/customer-boundary", {
    headers: authorization ? { authorization } : {}
  });
  const response = await fetch(`${backendApiBaseUrl()}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: backendApiRequestHeaders(request).headers
  });
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message || payload?.error?.code || `backend_${response.status}`);
  }
  return payload.data;
}

export async function loadCustomerOnboardingQueue(): Promise<CustomerOnboardingQueueItem[]> {
  const data = await trustedBackendGet<{ items?: CustomerOnboardingQueueItem[] }>("/api/customer-verifications");
  return Array.isArray(data.items) ? data.items : [];
}

function routeCustomerStatus(item: RouteCustomerBoundaryItem): RouteCustomerStatus {
  if (item.active === false) return "hidden";
  const lat = Number(item.geoLat);
  const lng = Number(item.geoLng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? "active" : "needs_gps";
}

export async function loadOwnedRouteCustomersData(): Promise<RouteCustomersData> {
  const data = await trustedBackendGet<{ items?: RouteCustomerBoundaryItem[] }>("/api/customer-verifications");
  const items = Array.isArray(data.items) ? data.items : [];
  const customers: RouteCustomerItem[] = items
    .map((item) => {
      const lat = Number(item.geoLat);
      const lng = Number(item.geoLng);
      const accuracy = Number(item.geoAccuracy);
      const hasGps = Number.isFinite(lat) && Number.isFinite(lng);
      const gps = hasGps
        ? {
            lat,
            lng,
            ...(Number.isFinite(accuracy) ? { accuracyMeters: accuracy } : {}),
            updatedAt: String(item.geoCapturedAt || item.updatedAt || "")
          }
        : undefined;
      const note = [item.address, item.note].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
      return {
        id: item.routeCustomerId,
        routeId: item.routeId,
        routeName: item.routeName || "Tuyến chưa xác định",
        accountId: String(item.customerId || item.coreCustomerId || item.routeCustomerId),
        accountName: item.customerName || "Điểm bán chưa đặt tên",
        contactName: item.phone || "",
        area: item.area || "Chưa cập nhật khu vực",
        sortOrder: Number(item.sortOrder || 0),
        status: routeCustomerStatus(item),
        ...(gps ? { gps } : {}),
        note
      } satisfies RouteCustomerItem;
    })
    .filter((item) => item.id && item.routeId);

  const active = customers.filter((customer) => customer.status === "active").length;
  const needsGps = customers.filter((customer) => customer.status === "needs_gps").length;
  const hidden = customers.filter((customer) => customer.status === "hidden").length;
  return {
    kpis: [
      { label: "Tổng điểm bán", value: customers.length, hint: "Trong các tuyến được phép xem" },
      { label: "Đang hoạt động", value: active, hint: "Đủ vị trí" },
      { label: "Cần GPS", value: needsGps, hint: "Cần bổ sung vị trí" },
      { label: "Đang ẩn", value: hidden, hint: "Không đưa vào phiên mới" }
    ],
    customers
  };
}

export type CoreCustomerItem = {
  id: string;
  customerCode: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  updatedAt: string | null;
};

export async function loadOwnedCoreCustomers(): Promise<CoreCustomerItem[]> {
  const data = await trustedBackendGet<{ customers?: CoreCustomerItem[] }>("/api/core-customers");
  return Array.isArray(data.customers) ? data.customers : [];
}

export type CoreSalesOrderLineItem = {
  quantity?: string | number | null;
};

export type CoreSalesOrderVersionItem = {
  versionNumber?: string | number | null;
  total?: string | number | null;
  createdAt?: string | null;
  lines?: CoreSalesOrderLineItem[];
};

export type CoreSalesOrderItem = {
  id: string;
  number?: string | null;
  status: string;
  currentVersionNumber?: string | number | null;
  sourceType?: string | null;
  sourceOutletId?: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  versions?: CoreSalesOrderVersionItem[];
};

export async function loadOwnedCoreSalesOrders(): Promise<CoreSalesOrderItem[]> {
  const data = await trustedBackendGet<CoreSalesOrderItem[]>("/api/core-sales/orders");
  return Array.isArray(data) ? data : [];
}
