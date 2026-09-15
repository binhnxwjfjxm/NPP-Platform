import { createHash } from "node:crypto";
import { loadMcpDayData } from "@/lib/api/mcp-day-data";
import { readMcpSessionToken, requestMcpInternalAuth } from "@/lib/internal-auth-client";

type CoreMe = Readonly<{ employeeId?: string }>;

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: Request) {
  const token = readMcpSessionToken();
  if (!token) return json({ error: { code: "UNAUTHORIZED", message: "Cần đăng nhập", retryable: false } }, 401);
  const me = await requestMcpInternalAuth<CoreMe>("/api/internal-auth/me", { method: "GET", token });
  if (!me.ok || !me.data?.employeeId) {
    return json({ error: { code: me.code || "MCP_AUTH_FAILED", message: "Không xác nhận được phiên đăng nhập lúc này.", retryable: me.retryable === true } }, me.status || 503);
  }

  const url = new URL(request.url);
  const routeId = String(url.searchParams.get("routeId") || "").trim();
  const date = String(url.searchParams.get("date") || "").slice(0, 10);
  const currentCursor = String(url.searchParams.get("cursor") || "").trim() || null;
  if (!routeId || !validDate(date)) {
    return json({ error: { code: "MCP_VISIT_DAY_INVALID", message: "Tuyến hoặc ngày không hợp lệ", retryable: false } }, 400);
  }

  try {
    const data = await loadMcpDayData({ routeId, date });
    const nextCursor = createHash("sha256").update(JSON.stringify(data)).digest("hex");
    return json({
      cursor: nextCursor,
      full: currentCursor !== nextCursor,
      upserts: currentCursor === nextCursor ? [] : [{ id: "visit-day", data }],
      removeIds: []
    });
  } catch {
    return json({ error: { code: "MCP_VISIT_DAY_UNAVAILABLE", message: "Chưa cập nhật được dữ liệu đi tuyến lúc này.", retryable: true } }, 503);
  }
}
