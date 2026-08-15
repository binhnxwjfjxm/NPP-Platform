import { NextRequest, NextResponse } from "next/server";
import { encodeMcpInternalAuthorization, type McpWorkforceUser } from "./lib/mcp-auth";
import { MCP_SESSION_COOKIE, safeMcpReturnTo } from "./lib/mcp-session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type MePayload = Readonly<{
  employeeId?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
  scopes?: readonly string[] | Readonly<{ warehouseIds?: readonly string[] }>;
  session?: Readonly<{ loginName?: string; employeeFullName?: string; expiresAt?: string }>;
}>;

type SessionState =
  | Readonly<{ state: "active"; user: McpWorkforceUser }>
  | Readonly<{ state: "invalid" | "unavailable" }>;

function isBrowserNavigation(request: NextRequest) {
  return (request.method === "GET" || request.method === "HEAD")
    && Boolean(request.headers.get("accept")?.includes("text/html"));
}

function deny(request: NextRequest, status: 401 | 503, code: string, message: string) {
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
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return null;
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
  if (value && typeof value === "object" && "warehouseIds" in value) {
    return stringList(value.warehouseIds);
  }
  return [];
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
    return deny(request, 503, "MCP_HTTPS_REQUIRED", "MCP customer access requires HTTPS");
  }

  const sessionToken = request.cookies.get(MCP_SESSION_COOKIE)?.value?.trim();
  if (!sessionToken) {
    if (isBrowserNavigation(request)) return loginRedirect(request);
    return deny(request, 401, "UNAUTHORIZED", "Authentication required");
  }

  const resolved = await resolveSession(sessionToken);
  if (resolved.state === "active") {
    const headers = new Headers(request.headers);
    headers.set("authorization", encodeMcpInternalAuthorization(resolved.user));
    headers.delete("x-npp-mcp-employee-id");
    return NextResponse.next({ request: { headers } });
  }
  if (resolved.state === "invalid") {
    const response = isBrowserNavigation(request)
      ? loginRedirect(request)
      : deny(request, 401, "UNAUTHORIZED", "Authentication required");
    return clearInvalidSession(response);
  }
  return deny(request, 503, "MCP_AUTH_UNAVAILABLE", "NPP Core authentication is temporarily unavailable");
}

export const config = {
  matcher: [
    "/customers/:path*",
    "/api/backend/customer-verifications/:path*",
    "/api/backend/core-customers/:path*"
  ]
};
