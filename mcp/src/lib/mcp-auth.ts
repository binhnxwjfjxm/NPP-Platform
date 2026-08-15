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

export function encodeMcpInternalAuthorization(user: McpWorkforceUser) {
  const identity = [
    "v2",
    user.username.trim(),
    user.employeeId.trim(),
    encodeURIComponent(user.displayName.trim() || user.username.trim())
  ].join("|");
  return `Basic ${btoa(identity)}`;
}
