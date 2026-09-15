import "server-only";

import { createHash } from "node:crypto";
import { readMcpSessionToken } from "@/lib/internal-auth-client";

export function mcpLocalCacheUserIdFromSession() {
  const token = readMcpSessionToken();
  if (!token) return null;
  return `mcp.${createHash("sha256").update(token).digest("hex").slice(0, 40)}`;
}
