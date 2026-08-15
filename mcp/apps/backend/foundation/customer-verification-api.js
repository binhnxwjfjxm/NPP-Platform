import {
  listCustomerVerifications,
  listOwnedCoreCustomers,
  submitCustomerVerification,
  syncCustomerVerification
} from "./customer-verification.js";

const MAX_JSON_BODY_BYTES = 256 * 1024;

function badRequest(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 400;
  throw error;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("request_body_too_large");
      error.code = "request_body_too_large";
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    badRequest("invalid_json_body");
  }
}

function response(data, statusCode = 200) {
  return { statusCode, payload: { data, receivedAt: new Date().toISOString() } };
}

export async function handleCustomerVerificationApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/customer-verifications") {
    return response({ items: await listCustomerVerifications(context) });
  }
  if (method === "GET" && pathname === "/api/core-customers") {
    return response({ customers: await listOwnedCoreCustomers(context) });
  }
  if (method === "POST" && pathname === "/api/customer-verifications/submit") {
    const body = await readJsonBody(req);
    return response(await submitCustomerVerification(body, context, config, { fetchImpl }), 200);
  }
  if (method === "POST" && pathname === "/api/customer-verifications/sync") {
    const body = await readJsonBody(req);
    return response(await syncCustomerVerification(body, context, config, { fetchImpl }), 200);
  }
  return null;
}
