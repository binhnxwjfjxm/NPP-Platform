import "server-only";

import { headers } from "next/headers";
import type { CustomerOnboardingQueueItem } from "@/features/accounts/customer-onboarding.types";
import { backendApiBaseUrl, backendApiRequestHeaders } from "@/lib/api/backend-proxy";

type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };

async function trustedBackendGet<T>(path: string): Promise<T> {
  const incoming = headers();
  const authorization = incoming.get("authorization");
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
