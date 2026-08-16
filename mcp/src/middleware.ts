import { NextRequest, NextResponse } from "next/server";
import { encodeMcpInternalAuthorization, isMcpInstallationOwner, type McpWorkforceUser } from "./lib/mcp-auth";
import { MCP_SESSION_COOKIE, safeMcpReturnTo } from "./lib/mcp-session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MePayload = Readonly<{
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

type SessionState =
  | Readonly<{ state: "active"; user: McpWorkforceUser }>
  | Readonly<{ state: "invalid" | "unavailable" }>;

function isBrowserNavigation(request: NextRequest) {
  return (request.method === "GET" || request.method === "HEAD")
    && Boolean(request.headers.get("accept")?.includes("text/html"));
}

function deny(request: NextRequest, status: 401 | 403 | 503, code: string, message: string) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  return request.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.json({ error: { code, message, retryable: status === 503 } }, { status, headers })
    : new NextResponse(message, { status, headers });
}

function loginRedirect(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const returnTo = safeMcpReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== "/customers") loginUrl.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(loginUrl);
}

function clearInvalidSession(response: NextResponse) {
  response.cookies.set(MCP_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  return response;
}

function coreBaseUrl(): string | null {
  const raw = process.env.CORE_API_INTERNAL_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const loopback = new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !loopback) return null;
    url.pathname = url.pathname.replace(/\/$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function scopeList(value: MePayload["scopes"]): string[] {
  if (Array.isArray(value)) return stringList(value);
  if (!value || typeof value !== "object") return [];
  const branchIds = "branchIds" in value ? stringList(value.branchIds) : [];
  const warehouseIds = "warehouseIds" in value ? stringList(value.warehouseIds) : [];
  const territoryIds = "territoryIds" in value ? stringList(value.territoryIds) : [];
  return [
    ...branchIds.filter((id) => UUID_PATTERN.test(id)).map((id) => `mcp:branch:${id.toLowerCase()}`),
    ...warehouseIds.filter((id) => UUID_PATTERN.test(id)).map((id) => `mcp:warehouse:${id.toLowerCase()}`),
    ...territoryIds.filter((id) => UUID_PATTERN.test(id)).map((id) => `mcp:territory:${id.toLowerCase()}`)
  ];
}

function requiredPermission(request: NextRequest): string | null {
  const path = request.nextUrl.pathname;
  const method = request.method.toUpperCase();
  if (path === "/mcp-setting" || path.startsWith("/mcp-setting/")) return "mcp.report-setting.write";
  if (path === "/routes" || path.startsWith("/routes/")) return "mcp.route.write";
  if (path === "/api/routes" || path.startsWith("/api/routes/")) return "mcp.route.write";
  if (path === "/api/route-customers" || path.startsWith("/api/route-customers/")) return "mcp.route-customer.write";
  if (
    path.startsWith("/api/mcp-report-settings")
    || path.startsWith("/api/mcp-report-setting-groups")
    || path.startsWith("/api/backend/mcp-report-settings")
  ) return "mcp.report-setting.write";
  if (method !== "GET" && method !== "HEAD" && path.startsWith("/api/backend/routes")) return "mcp.route.write";
  return null;
}

function hasCapability(user: McpWorkforceUser, permission: string) {
  if (isMcpInstallationOwner(user)) return true;
  const required = permission.trim().toLowerCase();
  return user.permissions.some((value) => String(value || "").trim().toLowerCase() === required);
}

async function resolveSession(token: string): Promise<SessionState> {
  const baseUrl = coreBaseUrl();
  if (!baseUrl) return { state: "unavailable" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${baseUrl}/api/internal-auth/me`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    if (response.status === 401 || response.status === 403) return { state: "invalid" };
    if (!response.ok) return { state: "unavailable" };
    const payload = await response.json().catch(() => null) as { data?: MePayload } | null;
    const employeeId = String(payload?.data?.employeeId || "").trim();
    const username = String(payload?.data?.session?.loginName || "").trim();
    const displayName = String(payload?.data?.session?.employeeFullName || "").trim();
    if (!UUID_PATTERN.test(employeeId) || !/^[A-Za-z0-9._-]{2,128}$/.test(username) || !displayName || !payload?.data) {
      return { state: "invalid" };
    }
    return {
      state: "active",
      user: {
        username,
        displayName,
        employeeId,
        roles: stringList(payload.data.roles),
        permissions: stringList(payload.data.permissions),
        scopes: scopeList(payload.data.scopes),
        expiresAt: String(payload.data.session?.expiresAt || "")
      }
    };
  } catch {
    return { state: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function middleware(request: NextRequest) {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (process.env.NODE_ENV === "production" && forwardedProtocol !== "https" && request.nextUrl.protocol !== "https:") {
    return deny(request, 503, "MCP_HTTPS_REQUIRED", "Truy cập MCP yêu cầu kết nối HTTPS");
  }

  const sessionToken = request.cookies.get(MCP_SESSION_COOKIE)?.value?.trim();
  if (!sessionToken) {
    if (isBrowserNavigation(request)) return loginRedirect(request);
    return deny(request, 401, "UNAUTHORIZED", "Cần đăng nhập");
  }

  const resolved = await resolveSession(sessionToken);
  if (resolved.state === "active") {
    const permission = requiredPermission(request);
    if (permission && !hasCapability(resolved.user, permission)) {
      return deny(request, 403, "FORBIDDEN", "Không có quyền thực hiện chức năng này");
    }
    const headers = new Headers(request.headers);
    headers.set("authorization", encodeMcpInternalAuthorization(resolved.user));
    headers.delete("x-npp-mcp-employee-id");
    return NextResponse.next({ request: { headers } });
  }
  if (resolved.state === "invalid") {
    const response = isBrowserNavigation(request)
      ? loginRedirect(request)
      : deny(request, 401, "UNAUTHORIZED", "Cần đăng nhập");
    return clearInvalidSession(response);
  }
  return deny(request, 503, "MCP_AUTH_UNAVAILABLE", "Xác thực Công Ty tạm thời chưa sẵn sàng");
}

export const config = {
  matcher: [
    "/customers/:path*",
    "/orders/:path*",
    "/routes/:path*",
    "/mcp-setting/:path*",
    "/api/products/:path*",
    "/api/backend/:path*",
    "/api/routes/:path*",
    "/api/route-customers/:path*",
    "/api/mcp-report-settings/:path*",
    "/api/mcp-report-setting-groups/:path*",
    "/api/backend/customer-verifications/:path*",
    "/api/backend/core-customers/:path*",
    "/api/backend/core-sales/orders/:path*"
  ]
};
