const PERMISSION_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const SCOPE_PATTERN = /^mcp:[a-z0-9][a-z0-9._:-]{0,126}$/;

function authorizationError(code, statusCode, publicDetails = {}) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicRetryable = false;
  error.publicDetails = publicDetails;
  return error;
}

function normalizedRequired(value, pattern, code) {
  const candidate = String(value ?? "").trim().toLowerCase();
  if (!pattern.test(candidate)) {
    const error = new TypeError(code);
    error.code = code;
    throw error;
  }
  return candidate;
}

function stringSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
}

function scopeMatches(grantedScopes, requiredScope) {
  if (grantedScopes.has(requiredScope)) return true;
  const separator = requiredScope.indexOf(":");
  if (separator <= 0) return false;
  const domain = requiredScope.slice(0, separator);
  return grantedScopes.has(`${domain}:*`);
}

export function requireAuthenticatedPrincipal(context) {
  if (context?.auth?.authenticated !== true || !context?.principal?.id) {
    throw authorizationError("authentication_required", 401);
  }
  return context.principal;
}

export function requirePermission(context, permission) {
  const required = normalizedRequired(permission, PERMISSION_PATTERN, "invalid_required_permission");
  const principal = requireAuthenticatedPrincipal(context);
  const permissions = stringSet(principal.permissions);
  if (!permissions.has(required)) {
    throw authorizationError("permission_denied", 403, { permission: required });
  }
  return principal;
}

export function requireScope(context, scope) {
  const required = normalizedRequired(scope, SCOPE_PATTERN, "invalid_required_scope");
  const principal = requireAuthenticatedPrincipal(context);
  const scopes = stringSet(principal.scopes);
  if (!scopeMatches(scopes, required)) {
    throw authorizationError("scope_denied", 403, { scope: required });
  }
  return principal;
}

export function authorizeCommand(context, { permission, scope } = {}) {
  const principal = requirePermission(context, permission);
  if (scope) requireScope(context, scope);
  return principal;
}
