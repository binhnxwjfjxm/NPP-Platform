import { NextRequest, NextResponse } from "next/server";
import { MCP_INTERNAL_SOURCE_APP, requestMcpInternalAuth } from "../../../../lib/internal-auth-client";
import { MCP_SESSION_COOKIE, mcpSessionCookieOptions, safeMcpReturnTo } from "../../../../lib/mcp-session";

type LoginData = Readonly<{
  token: string;
  session: Readonly<{ expiresAt?: string }>;
}>;

function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location, "Cache-Control": "no-store" } });
}

function loginError(returnTo: string, error: string, ownerCode = false) {
  const search = new URLSearchParams({ error });
  if (ownerCode) search.set("state", "owner_code_required");
  if (returnTo !== "/customers") search.set("returnTo", returnTo);
  return redirect(`/login?${search.toString()}`);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const loginName = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const ownerCode = String(form.get("ownerCode") || "").trim();
  const returnTo = safeMcpReturnTo(String(form.get("returnTo") || "/customers"));
  const result = await requestMcpInternalAuth<LoginData>("/api/internal-auth/login", {
    method: "POST",
    body: {
      loginName,
      password,
      ...(ownerCode ? { ownerCode } : {}),
      sourceApp: MCP_INTERNAL_SOURCE_APP
    }
  });

  if (!result.ok || !result.data?.token) {
    if (result.code === "INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED") return loginError(returnTo, "owner_challenge_required", true);
    if (result.code === "INTERNAL_AUTH_OWNER_CODE_INVALID") return loginError(returnTo, "owner_code_invalid", true);
    if (result.code === "INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE") return loginError(returnTo, "owner_challenge_unavailable", true);
    return loginError(returnTo, result.status >= 500 ? "auth_unavailable" : "invalid_credentials");
  }

  const response = redirect(returnTo);
  response.cookies.set(MCP_SESSION_COOKIE, result.data.token, mcpSessionCookieOptions(result.data.session?.expiresAt));
  return response;
}
