import "server-only";

import { headers } from "next/headers";
import type { CustomerOnboardingQueueItem } from "@/features/accounts/customer-onboarding.types";
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

const EMPLOYEE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    roles: [],
    permissions: [],
    scopes: [],
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
