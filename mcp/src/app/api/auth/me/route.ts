import { readMcpSessionToken, requestMcpInternalAuth } from "@/lib/internal-auth-client";

type CoreMe = Readonly<{
  employeeId?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
  scopes?: readonly string[] | Readonly<{
    branchIds?: readonly string[];
    warehouseIds?: readonly string[];
    territoryIds?: readonly string[];
  }>;
  session?: Readonly<{ loginName?: string; employeeFullName?: string; expiresAt?: string }>;
}>;

export const dynamic = "force-dynamic";

export async function GET() {
  const token = readMcpSessionToken();
  if (!token) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Cần đăng nhập" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const result = await requestMcpInternalAuth<CoreMe>("/api/internal-auth/me", { method: "GET", token });
  if (!result.ok || !result.data) {
    return Response.json(
      { error: { code: result.code || "MCP_AUTH_FAILED", message: result.message || "Không đọc được quyền truy cập", retryable: result.retryable === true } },
      { status: result.status || 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json({ data: result.data }, { headers: { "Cache-Control": "no-store" } });
}
