import "server-only";

import { createHash } from "node:crypto";
import { readAdminSessionToken } from "../../lib/internal-auth-client";

export function adminLocalCacheUserIdFromSession() {
  const token = readAdminSessionToken();
  if (!token) return null;
  return `admin.${createHash("sha256").update(token).digest("hex").slice(0, 40)}`;
}
