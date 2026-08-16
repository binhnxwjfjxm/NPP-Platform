export type McpWorkforceUser = {
  username: string;
  displayName: string;
  employeeId: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  expiresAt: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MCP_PERMISSION_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const MCP_SCOPE_PATTERN = /^mcp:[a-z0-9*][a-z0-9._:*-]{0,126}$/;
const CORE_INSTALLATION_OWNER_ROLES = new Set([
  "system:security-owner",
  "system:implementation-owner"
]);

function canonicalList(values: readonly string[], pattern: RegExp) {
  return [...new Set(values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => pattern.test(value)))].sort();
}

export function isMcpWorkforceUser(value: unknown): value is McpWorkforceUser {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const user = value as Record<string, unknown>;
  return typeof user.username === "string"
    && typeof user.displayName === "string"
    && typeof user.employeeId === "string"
    && UUID_PATTERN.test(user.employeeId)
    && Array.isArray(user.roles)
    && Array.isArray(user.permissions)
    && Array.isArray(user.scopes)
    && typeof user.expiresAt === "string";
}

export function isMcpInstallationOwner(user: Pick<McpWorkforceUser, "roles">) {
  return user.roles.some((role) => CORE_INSTALLATION_OWNER_ROLES.has(String(role || "").trim().toLowerCase()));
}

export function encodeMcpInternalAuthorization(user: McpWorkforceUser) {
  const identity = [
    "v4",
    user.username.trim(),
    user.employeeId.trim(),
    encodeURIComponent(user.displayName.trim() || user.username.trim()),
    isMcpInstallationOwner(user) ? "1" : "0",
    encodeURIComponent(JSON.stringify(canonicalList(user.permissions, MCP_PERMISSION_PATTERN))),
    encodeURIComponent(JSON.stringify(canonicalList(user.scopes, MCP_SCOPE_PATTERN)))
  ].join("|");
  return `Basic ${btoa(identity)}`;
}
