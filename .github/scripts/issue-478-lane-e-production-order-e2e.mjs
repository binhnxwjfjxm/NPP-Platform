import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createIdempotencyKey } from "../../packages/contracts/index.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_EMPLOYEE_ID = "00000000-0000-4000-8000-000000000478";
const OWNER_USERNAME = "issue-478-lane-e-production-smoke";
const OWNER_DISPLAY_NAME = "Issue 478 Lane E Production Smoke";
const CREATE_OPERATION = "mcp.sales-order.create";
const CANCEL_OPERATION = "core.sales-order.cancel";
const SMOKE_NOTE = "[SMOKE #478] Lane E MCP -> Core -> MCP production E2E";

function requiredEnv(name, { url = false } = {}) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name.toLowerCase()}_required`);
  return url ? value.replace(/\/+$/, "") : value;
}

function businessError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function errorCode(payload) {
  return String(payload?.error?.code || "").trim() || "unknown";
}

function ownerAuthorization() {
  const identity = [
    "v3",
    OWNER_USERNAME,
    OWNER_EMPLOYEE_ID,
    encodeURIComponent(OWNER_DISPLAY_NAME),
    "1"
  ].join("|");
  return `Basic ${Buffer.from(identity, "utf8").toString("base64")}`;
}

function mcpHeaders({ idempotencyKey = null, json = false } = {}) {
  const headers = {
    Accept: "application/json",
    "X-Backend-Token": requiredEnv("MCP_BACKEND_TOKEN"),
    Authorization: ownerAuthorization()
  };
  if (json) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

function coreHeaders(token, { idempotencyKey = null, json = false } = {}) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };
  if (json) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(label, url, init, expectedStatus, { retry = false } = {}) {
  const attempts = retry ? 2 : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(20_000)
      });
      const payload = await response.json().catch(() => null);
      if (response.status === expectedStatus && payload && typeof payload === "object") {
        console.error(`E2E_STEP=${label} HTTP=${response.status}`);
        return payload;
      }
      lastError = businessError(`${label}_http_${response.status}`, {
        status: response.status,
        serviceCode: errorCode(payload)
      });
      if (attempt < attempts && response.status >= 500) {
        await sleep(300);
        continue;
      }
      throw lastError;
    } catch (error) {
      lastError = error?.code ? error : businessError(`${label}_network_error`);
      const status = Number(lastError?.details?.status || 0);
      const retryableFailure = !status || status >= 500;
      if (attempt < attempts && retryableFailure) {
        await sleep(300);
        continue;
      }
      throw lastError;
    }
  }
  throw lastError || businessError(`${label}_failed`);
}

function linkedFixture(items) {
  const candidates = items.filter((item) => (
    ["approved", "linked_existing"].includes(String(item?.status || ""))
    && String(item?.routeCustomerId || "").trim().length > 0
    && UUID_PATTERN.test(String(item?.coreCustomerId || ""))
    && UUID_PATTERN.test(String(item?.coreCustomerAddressId || ""))
  ));
  const linkCounts = new Map();
  for (const item of candidates) {
    const key = `${String(item.coreCustomerId).toLowerCase()}|${String(item.coreCustomerAddressId).toLowerCase()}`;
    linkCounts.set(key, (linkCounts.get(key) || 0) + 1);
  }
  const unique = candidates.filter((item) => {
    const key = `${String(item.coreCustomerId).toLowerCase()}|${String(item.coreCustomerAddressId).toLowerCase()}`;
    return linkCounts.get(key) === 1;
  });
  const preferred = unique.find((item) => /(?:test|demo|smoke)/i.test(String(item?.customerName || "")));
  return preferred || unique[0] || null;
}

function pricedVariant(items) {
  return items.find((item) => (
    UUID_PATTERN.test(String(item?.variantId || ""))
    && item?.price !== null
    && item?.price !== undefined
    && Number.isFinite(Number(item.price))
  )) || null;
}

async function findCoreOrderBySourceId(coreUrl, salesToken, sourceId) {
  const payload = await requestJson(
    "core_recover_by_source",
    `${coreUrl}/api/sales-orders?limit=1000&offset=0`,
    { method: "GET", headers: coreHeaders(salesToken) },
    200
  );
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.find((order) => (
    String(order?.sourceType || "") === "MCP"
    && String(order?.sourceId || "") === sourceId
  )) || null;
}

async function run() {
  const mcpUrl = requiredEnv("MCP_URL", { url: true });
  const coreUrl = requiredEnv("CORE_URL", { url: true });
  const salesToken = requiredEnv("CORE_SALES_TOKEN");
  const bootstrapToken = requiredEnv("CORE_BOOTSTRAP_TOKEN");
  const createKey = createIdempotencyKey(CREATE_OPERATION, randomUUID());
  const cancelKey = createIdempotencyKey(CANCEL_OPERATION, randomUUID());

  let orderId = null;
  let primaryError = null;
  let cleanupError = null;
  let created = false;
  let coreReceived = false;
  let mcpReloaded = false;
  let cancelled = false;

  try {
    const customerPayload = await requestJson(
      "mcp_customer_fixture",
      `${mcpUrl}/api/customer-verifications`,
      { method: "GET", headers: mcpHeaders() },
      200
    );
    const fixture = linkedFixture(Array.isArray(customerPayload?.data?.items) ? customerPayload.data.items : []);
    if (!fixture) throw businessError("no_linked_customer_fixture");

    const productPayload = await requestJson(
      "mcp_product_fixture",
      `${mcpUrl}/api/core-sales/products/search?q=&limit=50`,
      { method: "GET", headers: mcpHeaders() },
      200
    );
    const variant = pricedVariant(Array.isArray(productPayload?.data) ? productPayload.data : []);
    if (!variant) throw businessError("no_priced_product_fixture");

    const createPayload = await requestJson(
      "mcp_order_create",
      `${mcpUrl}/api/core-sales/orders`,
      {
        method: "POST",
        headers: mcpHeaders({ idempotencyKey: createKey, json: true }),
        body: JSON.stringify({
          customerId: fixture.coreCustomerId,
          customerAddressId: fixture.coreCustomerAddressId,
          lines: [{ variantId: variant.variantId, quantity: "1", note: SMOKE_NOTE }],
          note: SMOKE_NOTE
        })
      },
      201,
      { retry: true }
    );

    const createdOrder = createPayload?.data;
    orderId = String(createdOrder?.id || "").trim();
    if (!UUID_PATTERN.test(orderId)) throw businessError("mcp_create_order_id_invalid");
    if (String(createdOrder?.sourceType || "") !== "MCP") throw businessError("mcp_create_source_type_mismatch");
    if (String(createdOrder?.sourceOutletId || "") !== String(fixture.routeCustomerId)) {
      throw businessError("mcp_create_source_outlet_mismatch");
    }
    if (String(createdOrder?.status || "") !== "draft") throw businessError("mcp_create_status_not_draft");
    created = true;

    const corePayload = await requestJson(
      "core_receive_order",
      `${coreUrl}/api/sales-orders/${encodeURIComponent(orderId)}`,
      { method: "GET", headers: coreHeaders(salesToken) },
      200
    );
    const coreOrder = corePayload?.data;
    if (String(coreOrder?.id || "") !== orderId) throw businessError("core_receive_order_id_mismatch");
    if (String(coreOrder?.sourceType || "") !== "MCP") throw businessError("core_receive_source_type_mismatch");
    if (String(coreOrder?.sourceId || "") !== createKey) throw businessError("core_receive_source_id_mismatch");
    if (String(coreOrder?.sourceOutletId || "") !== String(fixture.routeCustomerId)) {
      throw businessError("core_receive_source_outlet_mismatch");
    }
    coreReceived = true;

    const reloadPayload = await requestJson(
      "mcp_reload_orders",
      `${mcpUrl}/api/core-sales/orders`,
      { method: "GET", headers: mcpHeaders() },
      200
    );
    const reloaded = Array.isArray(reloadPayload?.data)
      ? reloadPayload.data.find((order) => String(order?.id || "") === orderId)
      : null;
    if (!reloaded) throw businessError("mcp_reload_order_missing");
    if (String(reloaded?.sourceType || "") !== "MCP") throw businessError("mcp_reload_source_type_mismatch");
    if (String(reloaded?.sourceId || "") !== createKey) throw businessError("mcp_reload_source_id_mismatch");
    mcpReloaded = true;
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (!orderId) {
        const recovered = await findCoreOrderBySourceId(coreUrl, salesToken, createKey);
        const recoveredId = String(recovered?.id || "").trim();
        if (UUID_PATTERN.test(recoveredId)) orderId = recoveredId;
      }
      if (orderId) {
        const cancelPayload = await requestJson(
          "core_cancel_smoke_order",
          `${coreUrl}/api/sales-orders/${encodeURIComponent(orderId)}/cancel`,
          {
            method: "POST",
            headers: coreHeaders(bootstrapToken, { idempotencyKey: cancelKey, json: true }),
            body: JSON.stringify({ reason: "Issue #478 Lane E production E2E cleanup" })
          },
          200,
          { retry: true }
        );
        if (String(cancelPayload?.data?.status || "") !== "cancelled") {
          throw businessError("cleanup_cancel_status_mismatch");
        }
        const finalPayload = await requestJson(
          "core_verify_cancelled",
          `${coreUrl}/api/sales-orders/${encodeURIComponent(orderId)}`,
          { method: "GET", headers: coreHeaders(salesToken) },
          200
        );
        if (String(finalPayload?.data?.status || "") !== "cancelled") {
          throw businessError("cleanup_final_status_mismatch");
        }
        cancelled = true;
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  const result = {
    ok: !primaryError && !cleanupError && created && coreReceived && mcpReloaded && cancelled,
    mcpOrderCreated: created,
    coreReceived,
    mcpReloaded,
    cleanupCancelled: cancelled,
    finalStatus: cancelled ? "cancelled" : "unknown",
    persistedTestOrder: cancelled ? "cancelled_audit_record" : "unknown",
    errorCode: primaryError?.code || cleanupError?.code || null,
    cleanupErrorCode: cleanupError?.code || null
  };

  const summary = [
    `MCP_ORDER_CREATE=${created ? "pass" : "fail"}`,
    `CORE_ORDER_RECEIVE=${coreReceived ? "pass" : "fail"}`,
    `MCP_RELOAD_ORDER=${mcpReloaded ? "pass" : "fail"}`,
    `SMOKE_ORDER_CLEANUP_CANCEL=${cancelled ? "pass" : "fail"}`,
    `SMOKE_ORDER_FINAL_STATUS=${result.finalStatus}`,
    `SMOKE_ORDER_PERSISTENCE=${result.persistedTestOrder}`,
    `E2E_RESULT=${result.ok ? "pass" : "fail"}`,
    ...(result.errorCode ? [`E2E_ERROR_CODE=${result.errorCode}`] : []),
    ...(result.cleanupErrorCode ? [`E2E_CLEANUP_ERROR_CODE=${result.cleanupErrorCode}`] : [])
  ].join("\n");

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  console.log(`ISSUE_478_LANE_E_ORDER_E2E_RESULT=${JSON.stringify(result)}`);
  if (!result.ok) process.exitCode = 1;
}

await run();
