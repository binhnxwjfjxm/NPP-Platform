import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  isValidIdempotencyKey,
  normalizeIdempotencyKey as normalizeContractIdempotencyKey
} from "../../../../packages/contracts/index.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ACTOR_ID_PATTERN = /^(service|user):[A-Za-z0-9][A-Za-z0-9._:-]{2,126}$/;
const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const EMPLOYEE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const PERMISSION_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const SCOPE_PATTERN = /^mcp:[a-z0-9*][a-z0-9._:*-]{0,126}$/;
const AUTHENTICATED_PROXY_REQUEST = Symbol("authenticated-proxy-request");
const MCP_INSTALLATION_OWNER_ROLE = "mcp.installation-owner";

function headerValue(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : String(value ?? "").trim();
}

export function normalizeRequestId(value) {
  const candidate = String(value ?? "").trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : `req_${randomUUID()}`;
}

export function normalizeIdempotencyKey(value) {
  const candidate = normalizeContractIdempotencyKey(value);
  if (!candidate) return null;
  if (!isValidIdempotencyKey(candidate)) {
    const error = new Error("invalid_idempotency_key");
    error.code = "invalid_idempotency_key";
    error.statusCode = 400;
    throw error;
  }
  return candidate;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function actorContextError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function defaultActor(config) {
  return {
    id: config.legacyActorId,
    type: "service",
    authentication: "backend-token"
  };
}

function authenticatedServiceActor(req, config) {
  const id = headerValue(req, "x-actor-id");
  const type = headerValue(req, "x-actor-type");
  const authentication = headerValue(req, "x-actor-authentication");
  const presentCount = [id, type, authentication].filter(Boolean).length;

  if (presentCount !== 3) return defaultActor(config);
  if (
    !ACTOR_ID_PATTERN.test(id) ||
    !id.startsWith("service:") ||
    type !== "service" ||
    authentication !== "backend-token"
  ) {
    actorContextError("invalid_actor_context");
  }

  return { id, type, authentication };
}

function normalizedList(value, pattern, code) {
  const source = Array.isArray(value) ? value : [];
  const unique = new Set();
  for (const item of source) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!normalized) continue;
    if (!pattern.test(normalized)) actorContextError(code);
    unique.add(normalized);
  }
  return Object.freeze([...unique].sort());
}

function defaultPrincipal(config) {
  const configured = config.servicePrincipal || {};
  return {
    id: configured.id || config.legacyActorId,
    type: configured.type || "service",
    authentication: configured.authentication || "backend-token",
    employeeId: configured.employeeId || null,
    roles: configured.roles || [],
    permissions: configured.permissions || [],
    scopes: configured.scopes || []
  };
}

export function normalizePrincipal(value, config) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : defaultPrincipal(config);
  const id = String(source.id || "").trim();
  const type = String(source.type || "").trim().toLowerCase();
  const authentication = String(source.authentication || "").trim().toLowerCase();
  const employeeId = String(source.employeeId || "").trim() || null;

  if (!ACTOR_ID_PATTERN.test(id) || !new Set(["service", "user"]).has(type)) {
    actorContextError("invalid_principal_identity");
  }
  if (!authentication || authentication.length > 64) actorContextError("invalid_principal_authentication");
  if (employeeId && !EMPLOYEE_ID_PATTERN.test(employeeId)) actorContextError("invalid_employee_identity");
  if (type === "service" && employeeId) actorContextError("service_principal_employee_forbidden");

  return Object.freeze({
    id,
    type,
    authentication,
    employeeId,
    roles: normalizedList(source.roles, ROLE_PATTERN, "invalid_principal_role"),
    permissions: normalizedList(source.permissions, PERMISSION_PATTERN, "invalid_principal_permission"),
    scopes: normalizedList(source.scopes, SCOPE_PATTERN, "invalid_principal_scope")
  });
}

function internalWorkforcePrincipal(req, config) {
  const authorization = headerValue(req, "authorization");
  if (!authorization || !authorization.toLowerCase().startsWith("basic ")) return null;
  let decoded;
  try {
    decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
  } catch {
    actorContextError("invalid_workforce_authorization", 401);
  }

  const parts = decoded.split("|");
  const [version, username, employeeId, encodedDisplayName] = parts;
  const ownerFlag = version === "v3" ? parts[4] : "0";
  const expectedLength = version === "v3" ? 5 : 4;
  if (
    !new Set(["v2", "v3"]).has(version) ||
    parts.length !== expectedLength ||
    !String(username || "").trim() ||
    !EMPLOYEE_UUID_PATTERN.test(String(employeeId || "").trim()) ||
    !new Set(["0", "1"]).has(ownerFlag)
  ) {
    actorContextError("invalid_workforce_authorization", 401);
  }

  let displayName = String(username).trim();
  try {
    displayName = decodeURIComponent(String(encodedDisplayName || "")) || displayName;
  } catch {
    actorContextError("invalid_workforce_authorization", 401);
  }
  const configured = config.servicePrincipal || {};
  const roles = [
    ...(configured.roles || []),
    ...(ownerFlag === "1" ? [MCP_INSTALLATION_OWNER_ROLE] : [])
  ];
  return {
    id: `user:${employeeId}`,
    type: "user",
    authentication: "core-workforce-session",
    employeeId,
    roles,
    permissions: configured.permissions || [],
    scopes: configured.scopes || [],
    username: String(username).trim(),
    displayName
  };
}

export function authenticateProxy(req, config) {
  const token = headerValue(req, "x-backend-token");
  if (!token || !safeEqual(token, config.backendApiToken)) {
    const error = new Error("backend_auth_required");
    error.code = "backend_auth_required";
    error.statusCode = 401;
    throw error;
  }
  Object.defineProperty(req, AUTHENTICATED_PROXY_REQUEST, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
}

export function buildRequestContext(req, config, { principal } = {}) {
  const requestId = normalizeRequestId(headerValue(req, "x-request-id"));
  const idempotencyKey = normalizeIdempotencyKey(headerValue(req, "idempotency-key"));
  const actor = req[AUTHENTICATED_PROXY_REQUEST] === true
    ? authenticatedServiceActor(req, config)
    : defaultActor(config);
  const resolvedPrincipal = normalizePrincipal(principal || defaultPrincipal(config), config);

  return Object.freeze({
    requestId,
    installation: Object.freeze({
      id: config.installationId,
      nppCode: config.nppCode
    }),
    actor: Object.freeze(actor),
    principal: resolvedPrincipal,
    auth: Object.freeze({
      mode: config.authMode,
      authenticated: req[AUTHENTICATED_PROXY_REQUEST] === true
    }),
    idempotencyKey,
    receivedAt: new Date().toISOString()
  });
}

export function authenticateRequestContext(req, config, options = {}) {
  authenticateProxy(req, config);
  const principal = options.principal || internalWorkforcePrincipal(req, config) || undefined;
  return buildRequestContext(req, config, { ...options, principal });
}

export function forwardedContextHeaders(context) {
  const headers = {
    "x-request-id": context.requestId,
    "x-installation-id": context.installation.id,
    "x-npp-code": context.installation.nppCode,
    "x-actor-id": context.actor.id,
    "x-actor-type": context.actor.type,
    "x-actor-authentication": context.actor.authentication
  };
  if (context.idempotencyKey) headers["idempotency-key"] = context.idempotencyKey;
  return headers;
}
