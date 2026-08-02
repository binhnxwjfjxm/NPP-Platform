import "server-only";

import { backendApiBaseUrl, backendApiRequestHeaders } from "@/lib/api/backend-proxy";

type QueryValue = string | number | boolean | null | undefined;

export type BackendReadOptions = {
  select?: string;
  order?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, QueryValue>;
  count?: boolean;
  request?: Request;
};

type BackendReadRequest = {
  table: string;
  select?: string;
  order?: string;
  limit?: number;
  offset?: number;
  filters?: Record<string, QueryValue>;
  count?: boolean;
};

async function parseBackendJson(response: Response) {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function normalizeFailure(payload: unknown, statusCode: number) {
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const nested = body.error && typeof body.error === "object" && !Array.isArray(body.error)
    ? body.error as Record<string, unknown>
    : {};
  const code = String(nested.code || body.code || nested.message || body.message || `backend_read_${statusCode}`).trim() || `backend_read_${statusCode}`;
  const error = new Error(code);
  (error as Error & { code?: string; statusCode?: number }).code = code;
  (error as Error & { code?: string; statusCode?: number }).statusCode = statusCode;
  if (nested.details && typeof nested.details === "object" && !Array.isArray(nested.details)) {
    (error as Error & { publicDetails?: Record<string, unknown> }).publicDetails = nested.details as Record<string, unknown>;
  }
  return error;
}

async function backendRead(table: string, options: BackendReadOptions = {}) {
  const response = await fetch(`${backendApiBaseUrl()}/api/read`, {
    method: "POST",
    cache: "no-store",
    headers: backendApiRequestHeaders(options.request, { hasBody: true }).headers,
    body: JSON.stringify({
      table,
      select: options.select,
      order: options.order,
      limit: options.limit,
      offset: options.offset,
      filters: options.filters,
      count: options.count === true
    } satisfies BackendReadRequest)
  });

  const payload = await parseBackendJson(response);
  if (!response.ok) throw normalizeFailure(payload, response.status || 500);
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as Record<string, unknown>).data;
  }
  return payload;
}

export async function backendReadRows<T>(table: string, options: BackendReadOptions = {}) {
  const data = await backendRead(table, options);
  return Array.isArray(data) ? data as T[] : [];
}

export async function backendReadCount(table: string, options: Omit<BackendReadOptions, "select" | "order" | "limit" | "offset"> = {}) {
  const data = await backendRead(table, { ...options, count: true });
  const numeric = Number(data);
  return Number.isFinite(numeric) ? numeric : 0;
}
