import { NextRequest, NextResponse } from "next/server";
import { requestMcpInternalAuth } from "../../../../lib/internal-auth-client";
import { MCP_SESSION_COOKIE, mcpSessionCookieOptions } from "../../../../lib/mcp-session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(MCP_SESSION_COOKIE)?.value?.trim() || null;
  if (token) {
    await requestMcpInternalAuth("/api/internal-auth/logout", { method: "POST", token });
  }
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
  response.cookies.set(MCP_SESSION_COOKIE, "", { ...mcpSessionCookieOptions(), expires: new Date(0) });
  return response;
}
