export const MCP_SESSION_COOKIE = "hp_mcp_session";

export function mcpSessionCookieOptions(expiresAt?: string) {
  const parsed = expiresAt ? new Date(expiresAt) : null;
  const expires = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  return Object.freeze({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(expires ? { expires } : {})
  });
}

export function safeMcpReturnTo(value: string | null | undefined): string {
  const candidate = String(value || "").trim();
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/customers";
}
