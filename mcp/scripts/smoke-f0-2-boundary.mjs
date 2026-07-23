const baseUrl = String(process.env.BACKEND_API_BASE_URL || "").trim().replace(/\/+$/, "");
const token = String(process.env.BACKEND_API_TOKEN || "").trim();
const allowedOrigin = String(process.env.F0_2_ALLOWED_ORIGIN || "").trim();
const deniedOrigin = String(process.env.F0_2_DENIED_ORIGIN || "https://invalid.example.com").trim();

if (!baseUrl) throw new Error("missing_backend_api_base_url");
if (!/^https?:\/\//i.test(baseUrl)) throw new Error("invalid_backend_api_base_url");
if (token.length < 32) throw new Error("backend_api_token_too_short");
if (!allowedOrigin) throw new Error("missing_f0_2_allowed_origin");

function assert(condition, code, detail = "") {
  if (!condition) {
    const error = new Error(code);
    error.detail = detail;
    throw error;
  }
}

async function request(path, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store"
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

function header(result, name) {
  return String(result.response.headers.get(name) || "");
}

function authHeaders(extra = {}) {
  return {
    Accept: "application/json",
    "X-Backend-Token": token,
    ...extra
  };
}

const results = [];

const health = await request("/api/health");
assert(health.response.status === 200, "health_not_200", String(health.response.status));
assert(Boolean(header(health, "x-request-id")), "health_missing_request_id");
assert(!health.body?.installationId && !health.body?.nppCode, "health_leaks_installation_identity");
results.push("health_public_ok");

const unauthorized = await request("/api/routes");
assert(unauthorized.response.status === 401, "business_api_without_token_must_be_401", String(unauthorized.response.status));
results.push("business_api_auth_required_ok");

const preflight = await request("/api/routes", {
  method: "OPTIONS",
  headers: {
    Origin: allowedOrigin,
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "Content-Type, X-Backend-Token, X-Request-Id, Idempotency-Key"
  }
});
assert(preflight.response.status === 204, "allowed_origin_preflight_failed", String(preflight.response.status));
assert(header(preflight, "access-control-allow-origin") === allowedOrigin, "allowed_origin_not_echoed");
results.push("cors_allowed_origin_ok");

const denied = await request("/api/routes", {
  headers: authHeaders({ Origin: deniedOrigin })
});
assert(denied.response.status === 403, "denied_origin_must_be_403", String(denied.response.status));
results.push("cors_denied_origin_ok");

const requestId = `smoke_${crypto.randomUUID()}`;
const authorized = await request("/api/routes", {
  headers: authHeaders({
    Origin: allowedOrigin,
    "X-Request-Id": requestId,
    "Idempotency-Key": `smoke-${crypto.randomUUID()}`
  })
});
assert(authorized.response.status >= 200 && authorized.response.status < 300, "authorized_business_api_failed", `${authorized.response.status}`);
assert(header(authorized, "x-request-id") === requestId, "request_id_not_preserved");
assert(header(authorized, "access-control-allow-origin") === allowedOrigin, "authorized_cors_header_missing");
results.push("authorized_business_api_ok");
results.push("request_id_preserved_ok");

console.log(JSON.stringify({
  ok: true,
  target: new URL(baseUrl).origin,
  checks: results,
  receivedAt: new Date().toISOString()
}, null, 2));
