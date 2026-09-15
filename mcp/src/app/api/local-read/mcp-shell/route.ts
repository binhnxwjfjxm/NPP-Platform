import { readMcpSessionToken, requestMcpInternalAuth } from "@/lib/internal-auth-client";
import { loadMcpShellDelta } from "@/lib/local-read/mcp-shell-server";

type CoreMe = Readonly<{ employeeId?: string }>;

export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number, retryable = false) {
  return Response.json({ error: { code, message, retryable } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const token = readMcpSessionToken();
  if (!token) return errorResponse("UNAUTHORIZED", "Cần đăng nhập", 401);

  const me = await requestMcpInternalAuth<CoreMe>("/api/internal-auth/me", { method: "GET", token });
  if (!me.ok || !me.data?.employeeId) {
    return errorResponse(me.code || "MCP_AUTH_FAILED", me.message || "Không đọc được phiên đăng nhập", me.status || 503, me.retryable === true);
  }

  try {
    const cursor = String(new URL(request.url).searchParams.get("cursor") || "").trim() || null;
    const result = await loadMcpShellDelta(cursor);
    return Response.json({
      cursor: result.cursor,
      full: !result.unchanged,
      upserts: result.row ? [result.row] : [],
      removeIds: []
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse("MCP_LOCAL_READ_UNAVAILABLE", "Chưa cập nhật được dữ liệu MCP", 503, true);
  }
}
