import { createHash } from "node:crypto";
import { readMcpSessionToken, requestMcpInternalAuth } from "@/lib/internal-auth-client";
import { loadOwnedCoreCustomers } from "@/lib/api/customer-onboarding-data";
import { loadOrdersLocalData } from "@/features/orders/orders-local-data";
import { loadMarketReportsLocalData } from "@/features/market-reports/market-reports-local-data";

type Resource = "customers" | "orders" | "reports";
type CoreMe = Readonly<{ employeeId?: string }>;

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function parseResource(value: string | null): Resource | null {
  return value === "customers" || value === "orders" || value === "reports" ? value : null;
}

function resourceName(resource: Resource) {
  return `page.${resource}`;
}

function cursorFor(data: unknown) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

async function loadResource(resource: Resource) {
  if (resource === "customers") return loadOwnedCoreCustomers();
  if (resource === "orders") return loadOrdersLocalData();
  return loadMarketReportsLocalData();
}

export async function GET(request: Request) {
  const token = readMcpSessionToken();
  if (!token) return json({ error: { code: "UNAUTHORIZED", message: "Cần đăng nhập", retryable: false } }, 401);
  const me = await requestMcpInternalAuth<CoreMe>("/api/internal-auth/me", { method: "GET", token });
  if (!me.ok || !me.data?.employeeId) {
    return json({ error: { code: me.code || "MCP_AUTH_FAILED", message: "Không xác nhận được phiên đăng nhập lúc này.", retryable: me.retryable === true } }, me.status || 503);
  }
  const url = new URL(request.url);
  const resource = parseResource(url.searchParams.get("resource"));
  if (!resource) return json({ error: { code: "MCP_PAGE_LOCAL_READ_RESOURCE_INVALID", message: "Nguồn dữ liệu không hợp lệ", retryable: false } }, 400);
  const currentCursor = String(url.searchParams.get("cursor") || "").trim() || null;
  try {
    const data = await loadResource(resource);
    const nextCursor = cursorFor(data);
    return json({ cursor: nextCursor, full: currentCursor !== nextCursor, upserts: currentCursor === nextCursor ? [] : [{ id: resourceName(resource), data }], removeIds: [] });
  } catch {
    return json({ error: { code: "MCP_PAGE_LOCAL_READ_UNAVAILABLE", message: "Chưa cập nhật được dữ liệu MCP lúc này.", retryable: true } }, 503);
  }
}
