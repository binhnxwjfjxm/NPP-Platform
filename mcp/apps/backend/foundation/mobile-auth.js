const MOBILE_SOURCE_APP = "mcp-field-mobile";
const MOBILE_AUTH_PREFIX = "/api/mobile-auth";
const CORE_OWNER_ROLES = new Set([
  "system:security-owner",
  "system:implementation-owner"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_PATTERN = /^[A-Za-z0-9._-]{2,128}$/;
const MCP_PERMISSION_PATTERN = /^mcp\.[a-z0-9][a-z0-9._:-]{1,126}$/;
const MAX_BODY_BYTES = 64 * 1024;

function mobileAuthError(code, statusCode = 400, retryable = false, publicMessage = "") {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicRetryable = retryable;
  if (publicMessage) error.publicMessage = publicMessage;
  return error;
}

function coreAuthConfig(config) {
  const boundary = config?.coreAuth;
  if (!boundary?.configured || !boundary.baseUrl) {
    throw mobileAuthError(
      "upstream_unavailable",
      503,
      true,
      "Xác thực Công Ty tạm thời chưa sẵn sàng."
    );
  }
  return boundary;
}

function bearerToken(req) {
  const raw = Array.isArray(req?.headers?.authorization)
    ? req.headers.authorization[0]
    : String(req?.headers?.authorization ?? "").trim();
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || "";
}

export function isMobileSessionRequest(req) {
  return bearerToken(req).startsWith("nppusr.");
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw mobileAuthError("request_body_too_large", 413);
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid");
    }
    return value;
  } catch {
    throw mobileAuthError("invalid_json_body", 400);
  }
}

async function coreRequest(config, path, {
  method,
  token = "",
  body,
  requestId,
  fetchImpl = globalThis.fetch
}) {
  const boundary = coreAuthConfig(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundary.timeoutMs);
  timeout.unref?.();

  let response;
  try {
    response = await fetchImpl(`${boundary.baseUrl}${path}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Request-Id": requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw mobileAuthError("upstream_timeout", 504, true);
    }
    throw mobileAuthError("upstream_unavailable", 503, true);
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw mobileAuthError("upstream_response_invalid", 502, true);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw mobileAuthError("upstream_response_invalid", 502, true);
  }
  return { statusCode: response.status, payload };
}

function mobileSessionData(payload) {
  const data = payload?.data;
  const sourceApp = String(data?.sourceApp || data?.session?.sourceApp || "").trim();
  if (
    !data ||
    typeof data !== "object" ||
    sourceApp !== MOBILE_SOURCE_APP ||
    !UUID_PATTERN.test(String(data.employeeId || "").trim())
  ) {
    throw mobileAuthError("unauthorized", 401, false, "Phiên đăng nhập không còn hiệu lực.");
  }
  return data;
}

function mappedScopes(value) {
  const scopes = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = [];
  for (const [key, prefix] of [
    ["branchIds", "branch"],
    ["warehouseIds", "warehouse"],
    ["territoryIds", "territory"]
  ]) {
    for (const id of Array.isArray(scopes[key]) ? scopes[key] : []) {
      const normalized = String(id || "").trim().toLowerCase();
      if (UUID_PATTERN.test(normalized)) output.push(`mcp:${prefix}:${normalized}`);
    }
  }
  return [...new Set(output)].sort();
}

export function mobilePrincipalFromCoreMe(data, config) {
  const employeeId = String(data?.employeeId || "").trim().toLowerCase();
  const loginName = String(data?.session?.loginName || "").trim();
  const displayName = String(data?.session?.employeeFullName || "").trim() || loginName;
  if (!UUID_PATTERN.test(employeeId) || !LOGIN_PATTERN.test(loginName) || !displayName) {
    throw mobileAuthError("unauthorized", 401, false, "Phiên đăng nhập không còn hiệu lực.");
  }

  const coreRoles = Array.isArray(data.roles)
    ? data.roles.map((item) => String(item || "").trim().toLowerCase())
    : [];
  const owner = coreRoles.some((role) => CORE_OWNER_ROLES.has(role));
  const permissions = (Array.isArray(data.permissions) ? data.permissions : [])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => MCP_PERMISSION_PATTERN.test(item));
  const scopes = mappedScopes(data.scopes);

  return Object.freeze({
    id: `user:${employeeId}`,
    type: "user",
    authentication: "core-workforce-session",
    employeeId,
    roles: Object.freeze(owner ? ["mcp.installation-owner"] : []),
    permissions: Object.freeze([
      ...new Set([
        ...(owner ? config?.servicePrincipal?.permissions || [] : []),
        ...permissions
      ])
    ].sort()),
    scopes: Object.freeze([
      ...new Set([
        ...(owner ? config?.servicePrincipal?.scopes || [] : []),
        ...scopes
      ])
    ].sort()),
    username: loginName,
    displayName
  });
}

export async function resolveMobileSessionPrincipal(
  req,
  config,
  { requestId, fetchImpl = globalThis.fetch } = {}
) {
  const token = bearerToken(req);
  if (!token.startsWith("nppusr.")) {
    throw mobileAuthError("unauthorized", 401, false, "Cần đăng nhập.");
  }

  const result = await coreRequest(config, "/api/internal-auth/me", {
    method: "GET",
    token,
    requestId,
    fetchImpl
  });
  if (result.statusCode >= 400) {
    const nested = result.payload?.error || {};
    throw mobileAuthError(
      nested.code || "unauthorized",
      result.statusCode === 401 || result.statusCode === 403 ? result.statusCode : 503,
      result.statusCode >= 500 || nested.retryable === true,
      nested.message || ""
    );
  }

  const data = mobileSessionData(result.payload);
  return Object.freeze({
    principal: mobilePrincipalFromCoreMe(data, config),
    session: data.session
  });
}

export async function handleMobileAuthApi(
  req,
  url,
  config,
  { requestId, fetchImpl = globalThis.fetch } = {}
) {
  if (!(url.pathname === MOBILE_AUTH_PREFIX || url.pathname.startsWith(`${MOBILE_AUTH_PREFIX}/`))) {
    return null;
  }

  if (url.pathname === `${MOBILE_AUTH_PREFIX}/login`) {
    if (String(req.method || "").toUpperCase() !== "POST") {
      throw mobileAuthError("method_not_allowed", 405);
    }
    const body = await readJsonBody(req);
    const loginName = String(body.loginName ?? body.username ?? "").trim();
    const password = typeof body.password === "string" ? body.password : "";
    const ownerCode = String(body.ownerCode ?? "").trim();
    const result = await coreRequest(config, "/api/internal-auth/login", {
      method: "POST",
      requestId,
      fetchImpl,
      body: {
        loginName,
        password,
        ...(ownerCode ? { ownerCode } : {}),
        sourceApp: MOBILE_SOURCE_APP
      }
    });

    if (result.statusCode < 400) {
      const data = result.payload?.data;
      if (
        !data ||
        typeof data !== "object" ||
        typeof data.token !== "string" ||
        !data.token.startsWith("nppusr.") ||
        String(data.session?.sourceApp || "") !== MOBILE_SOURCE_APP
      ) {
        throw mobileAuthError("upstream_response_invalid", 502, true);
      }
    }
    return result;
  }

  if (url.pathname === `${MOBILE_AUTH_PREFIX}/me`) {
    if (String(req.method || "").toUpperCase() !== "GET") {
      throw mobileAuthError("method_not_allowed", 405);
    }
    const token = bearerToken(req);
    if (!token.startsWith("nppusr.")) {
      throw mobileAuthError("unauthorized", 401, false, "Cần đăng nhập.");
    }
    const result = await coreRequest(config, "/api/internal-auth/me", {
      method: "GET",
      token,
      requestId,
      fetchImpl
    });
    if (result.statusCode < 400) mobileSessionData(result.payload);
    return result;
  }

  if (url.pathname === `${MOBILE_AUTH_PREFIX}/logout`) {
    if (String(req.method || "").toUpperCase() !== "POST") {
      throw mobileAuthError("method_not_allowed", 405);
    }
    const token = bearerToken(req);
    if (!token.startsWith("nppusr.")) {
      throw mobileAuthError("unauthorized", 401, false, "Cần đăng nhập.");
    }
    return coreRequest(config, "/api/internal-auth/logout", {
      method: "POST",
      token,
      requestId,
      fetchImpl
    });
  }

  throw mobileAuthError("not_found", 404);
}

export const mobileAuthInternals = Object.freeze({
  MOBILE_SOURCE_APP,
  MOBILE_AUTH_PREFIX
});
