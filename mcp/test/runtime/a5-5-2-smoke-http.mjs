import { asObject as object, readJsonValue } from "./json-response.mjs";

export { object };
export const gatewayBase = String(process.env.MCP_API_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
export const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
export const backendToken = String(process.env.BACKEND_API_TOKEN || "").trim();
export const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
export const expectedInstallationId = String(process.env.NPP_F05_EXPECTED_INSTALLATION_ID || process.env.MCP_INSTALLATION_ID || "").trim();
export const expectedNppCode = String(process.env.NPP_F05_EXPECTED_NPP_CODE || process.env.MCP_NPP_CODE || "").trim();
export const actorId = String(process.env.NPP_F05_EXPECTED_ACTOR_ID || process.env.MCP_ACTOR_ID || "service:mcp-plan:f05-runtime-smoke").trim();
export const actorAuthentication = String(process.env.NPP_F05_EXPECTED_ACTOR_AUTHENTICATION || "backend-token").trim();
export const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function sameJson(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function errorCode(payload) {
  const root = object(payload);
  const envelope = object(root.error);
  return String(envelope.code || root.error || root.message || "request_failed");
}

export function flattenErrors(error) {
  if (error instanceof AggregateError) {
    return Array.from(error.errors || []).flatMap((item) => flattenErrors(item));
  }
  return [error?.message || String(error)];
}

export async function gateway(path, {
  method = "GET",
  body,
  requestId = `a552-runtime-${stamp}`,
  idempotencyKey,
  actor = actorId
} = {}) {
  const response = await fetch(`${gatewayBase}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "X-Backend-Token": backendToken,
      "X-Request-Id": requestId,
      "X-Actor-Id": actor,
      "X-Actor-Type": "service",
      "X-Actor-Authentication": actorAuthentication,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = object(await readJsonValue(response, `${method} ${path}`));
  return { response, payload, requestId };
}

export function verifyCanonical(result, label) {
  ensure(result.payload.requestId === result.requestId, `${label}: request_id_mismatch`);
  ensure(typeof result.payload.receivedAt === "string", `${label}: received_at_missing`);
  ensure(Object.prototype.hasOwnProperty.call(result.payload, "data"), `${label}: canonical_data_missing`);
}

export async function must(path, options = {}) {
  const result = await gateway(path, options);
  if (!result.response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${result.response.status}: ${errorCode(result.payload)}`);
  }
  verifyCanonical(result, `${options.method || "GET"} ${path}`);
  return result;
}

export async function mustConflict(path, options = {}) {
  const result = await gateway(path, options);
  ensure(result.response.status === 409, `${path}: expected_409_got_${result.response.status}`);
  ensure(
    errorCode(result.payload).toLowerCase().includes("idempotency_key_conflict"),
    `${path}: wrong_conflict_code_${errorCode(result.payload)}`
  );
  ensure(result.payload.requestId === result.requestId, `${path}: conflict_request_id_mismatch`);
  ensure(typeof result.payload.receivedAt === "string", `${path}: conflict_received_at_missing`);
}

export async function db(path) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`
    }
  });
  const payload = await readJsonValue(response, `DB GET ${path}`);
  if (!response.ok) throw new Error(`DB GET ${path} -> ${response.status}: ${errorCode(payload)}`);
  ensure(Array.isArray(payload), `DB GET ${path}: response_not_array`);
  return payload;
}

export function replayed(payload) {
  return object(object(object(payload).meta).idempotency).replayed === true;
}

export function auditRows(operation, idempotencyKey) {
  return db(
    "mcp_audit_events" +
      `?operation=eq.${encodeURIComponent(operation)}` +
      `&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}` +
      "&select=request_id,action,outcome,status_code,aggregate_id,installation_id,npp_code,actor_id,actor_type,actor_authentication,http_method,route,metadata&order=occurred_at.asc"
  );
}

export function idempotencyRows(operation, idempotencyKey) {
  return db(
    "mcp_idempotency_records" +
      `?operation=eq.${encodeURIComponent(operation)}` +
      `&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}` +
      "&select=status,attempt_count,response_status,original_request_id,last_request_id,aggregate_id,installation_id,npp_code,actor_id,actor_type,actor_authentication,http_method,route,action"
  );
}

function r2Config() {
  return {
    endpoint: String(process.env.R2_ENDPOINT || process.env.CLOUDFLARE_R2_ENDPOINT || "").replace(/\/+$/, ""),
    bucket: String(process.env.R2_BUCKET_NAME || "").trim(),
    accessKeyId: String(process.env.R2_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY || "").trim(),
    region: String(process.env.R2_REGION || "auto").trim() || "auto"
  };
}

export async function r2Head(objectKey) {
  const { signedR2HeadRequest } = await import("../../apps/backend/foundation/r2-storage.js");
  const request = signedR2HeadRequest(r2Config(), objectKey);
  return fetch(request.url, { ...request.init, cache: "no-store" });
}

export async function r2Delete(objectKey) {
  const { signedR2DeleteRequest } = await import("../../apps/backend/foundation/r2-storage.js");
  const request = signedR2DeleteRequest(r2Config(), objectKey);
  return fetch(request.url, { ...request.init, cache: "no-store" });
}

export async function putSignedObject(putUrl, requiredHeaders, bytes) {
  const response = await fetch(putUrl, { method: "PUT", headers: requiredHeaders || {}, body: bytes });
  ensure(response.ok, `r2_put_failed_${response.status}`);
  return response;
}

export async function dbRpc(name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`
    },
    body: JSON.stringify(body || {})
  });
  const payload = await readJsonValue(response, `DB RPC ${name}`);
  if (!response.ok) throw new Error(`DB RPC ${name} -> ${response.status}: ${errorCode(payload)}`);
  return payload;
}
