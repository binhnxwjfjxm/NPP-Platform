import http from "node:http";
import { corsHeaders, resolveCorsOrigin } from "./cors.js";
import { canonicalErrorPayload, canonicalSuccessPayload, normalizeApiPayload, parseJsonPayload } from "./api-contract.js";
import { authenticateRequestContext, forwardedContextHeaders, normalizeRequestId } from "./request-context.js";
import { withFoundationRequestContext } from "./request-context-store.js";
import { handleReadApi } from "./read-api.js";

const LIVE_PATHS = new Set(["/", "/health/live"]);
const READY_PATHS = new Set(["/health", "/api/health", "/health/ready"]);
const MAX_UPSTREAM_RESPONSE_BYTES = 16 * 1024 * 1024;
const REQUEST_HEADER_BLOCKLIST = new Set(["connection", "host", "origin", "x-backend-token", "x-request-id", "x-installation-id", "x-npp-code", "x-actor-id", "x-actor-type", "x-actor-authentication"]);

function json(res, statusCode, payload, requestId, origin = null, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Request-Id": requestId, ...extraHeaders, ...corsHeaders(origin) });
  res.end(body);
}

function noContent(res, requestId, origin = null) {
  res.writeHead(204, { "Cache-Control": "no-store", "X-Request-Id": requestId, ...corsHeaders(origin) });
  res.end();
}

function liveData(config) {
  return { service: config.service, status: "live", installationConfigured: Boolean(config.installationId && config.nppCode), persistenceProvider: config.persistence.provider, authBoundary: config.authMode };
}

async function readyData(config, persistence) {
  const state = await persistence.readiness();
  if (!state.ready) {
    const error = new Error("provider_unavailable");
    error.code = "PROVIDER_UNAVAILABLE";
    error.statusCode = 503;
    error.publicRetryable = true;
    throw error;
  }
  return { service: config.service, status: "ready", installationConfigured: Boolean(config.installationId && config.nppCode), persistenceProvider: state.provider, persistenceConfigured: state.configured, authBoundary: config.authMode };
}

function upstreamHeaders(req, context, config) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || REQUEST_HEADER_BLOCKLIST.has(name.toLowerCase())) continue;
    headers[name] = value;
  }
  Object.assign(headers, forwardedContextHeaders(context));
  headers.host = `${config.internalHost}:${config.internalPort}`;
  headers["x-forwarded-proto"] = req.socket.encrypted ? "https" : "http";
  headers["x-forwarded-host"] = String(req.headers.host || "");
  headers["x-forwarded-for"] = String(req.socket.remoteAddress || "");
  return headers;
}

function writeNormalized(res, normalized, requestId, origin, extraHeaders = {}) {
  json(res, normalized.statusCode, normalized.payload, requestId, origin, extraHeaders);
}

function proxyToLegacy(req, res, url, context, origin, config) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => { if (finished) return false; finished = true; resolve(); return true; };
    const upstream = http.request({ host: config.internalHost, port: config.internalPort, method: req.method, path: `${url.pathname}${url.search}`, headers: upstreamHeaders(req, context, config) }, (upstreamResponse) => {
      const chunks = [];
      let size = 0;
      upstreamResponse.on("data", (chunk) => {
        if (finished) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_UPSTREAM_RESPONSE_BYTES) {
          upstreamResponse.destroy();
          if (finish()) writeNormalized(res, canonicalErrorPayload({ code: "UPSTREAM_RESPONSE_INVALID", statusCode: 502 }, { requestId: context.requestId, receivedAt: context.receivedAt, status: 502 }), context.requestId, origin);
          return;
        }
        chunks.push(buffer);
      });
      upstreamResponse.on("end", () => {
        if (!finish()) return;
        const parsed = parseJsonPayload(Buffer.concat(chunks).toString("utf8"));
        if (!parsed.ok) {
          writeNormalized(res, canonicalErrorPayload({ code: "UPSTREAM_RESPONSE_INVALID", statusCode: 502 }, { requestId: context.requestId, receivedAt: context.receivedAt, status: 502 }), context.requestId, origin);
          return;
        }
        writeNormalized(res, normalizeApiPayload(parsed.value, { status: upstreamResponse.statusCode || 502, requestId: context.requestId, receivedAt: context.receivedAt }), context.requestId, origin);
      });
    });
    upstream.setTimeout(config.upstreamTimeoutMs, () => upstream.destroy(new Error("legacy_upstream_timeout")));
    upstream.on("error", (error) => {
      if (!finish()) return;
      if (!res.headersSent) writeNormalized(res, canonicalErrorPayload(error, { requestId: context.requestId, receivedAt: context.receivedAt, status: error.message === "legacy_upstream_timeout" ? 504 : 502 }), context.requestId, origin);
      else res.destroy(error);
    });
    req.on("aborted", () => upstream.destroy(new Error("client_aborted")));
    req.pipe(upstream);
  });
}

export function createFoundationGateway(config, { persistence, legacyHandlers = null } = {}) {
  if (!persistence || typeof persistence.readiness !== "function") throw new TypeError("persistence adapter is required");
  return http.createServer(async (req, res) => {
    const requestId = normalizeRequestId(req.headers["x-request-id"]);
    const receivedAt = new Date().toISOString();
    req.headers["x-request-id"] = requestId;
    let origin = null;
    try {
      origin = resolveCorsOrigin(req, config.corsOrigins);
      const url = new URL(req.url || "/", `http://${req.headers.host || `${config.publicHost}:${config.publicPort}`}`);
      if (req.method === "OPTIONS") { noContent(res, requestId, origin); return; }
      if (LIVE_PATHS.has(url.pathname)) { json(res, 200, canonicalSuccessPayload(liveData(config), { requestId, receivedAt }), requestId, origin); return; }
      if (READY_PATHS.has(url.pathname)) { json(res, 200, canonicalSuccessPayload(await readyData(config, persistence), { requestId, receivedAt }), requestId, origin); return; }

      const context = authenticateRequestContext(req, config);
      req.foundationContext = context;

      await withFoundationRequestContext(context, async () => {
        const readApi = await handleReadApi(req, url, context, config, { persistence });
        if (readApi) {
          writeNormalized(res, normalizeApiPayload(readApi.payload, { status: readApi.statusCode, requestId: context.requestId, receivedAt: context.receivedAt }), context.requestId, origin);
          return;
        }

        if (!legacyHandlers) {
          await persistence.assertReady();
          const error = new Error("provider_unavailable");
          error.code = "PROVIDER_UNAVAILABLE";
          error.statusCode = 503;
          throw error;
        }

        const orderApi = await legacyHandlers.handleOrderApi(req, url, context, config);
        if (orderApi) { writeNormalized(res, normalizeApiPayload(orderApi.payload, { status: orderApi.statusCode, requestId: context.requestId, receivedAt: context.receivedAt }), context.requestId, origin); return; }
        const routeApi = await legacyHandlers.handleRouteApi(req, url, context, config);
        if (routeApi) { writeNormalized(res, normalizeApiPayload(routeApi.payload, { status: routeApi.statusCode, requestId: context.requestId, receivedAt: context.receivedAt }), context.requestId, origin); return; }
        const transitional = await legacyHandlers.handleTransitionalApi(req, url, context, config);
        if (transitional) { writeNormalized(res, normalizeApiPayload(transitional.payload, { status: transitional.statusCode, requestId: context.requestId, receivedAt: context.receivedAt }), context.requestId, origin); return; }
        if (legacyHandlers.proxyToLegacy) { await proxyToLegacy(req, res, url, context, origin, config); return; }
        const error = new Error("not_found");
        error.code = "NOT_FOUND";
        error.statusCode = 404;
        throw error;
      });
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      const retryAfterSeconds = Number(error?.publicDetails?.retryAfterSeconds || 0);
      const extraHeaders = error?.code === "idempotency_in_progress" && Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0 ? { "Retry-After": String(Math.min(retryAfterSeconds, 300)) } : {};
      writeNormalized(res, canonicalErrorPayload(error, { requestId, receivedAt, status }), requestId, origin, extraHeaders);
    }
  });
}

export function waitForLegacyHealth(config, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get({ host: config.internalHost, port: config.internalPort, path: "/api/health", timeout: 500 }, (response) => {
        response.resume();
        if ((response.statusCode || 500) < 500) { resolve(); return; }
        retry();
      });
      request.on("timeout", () => request.destroy());
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() >= deadline) { reject(new Error("legacy_backend_not_ready")); return; }
      setTimeout(check, 75);
    };
    check();
  });
}
