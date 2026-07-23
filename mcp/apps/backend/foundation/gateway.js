import http from "node:http";
import { corsHeaders, resolveCorsOrigin } from "./cors.js";
import {
  canonicalErrorPayload,
  canonicalSuccessPayload,
  normalizeApiPayload,
  parseJsonPayload
} from "./api-contract.js";
import {
  authenticateProxy,
  buildRequestContext,
  forwardedContextHeaders,
  normalizeRequestId
} from "./request-context.js";
import { handleOrderApi } from "./order-api.js";
import { handleRouteApi } from "./route-api.js";
import { handleTransitionalApi } from "./transitional-api.js";

const PUBLIC_HEALTH_PATHS = new Set(["/", "/health", "/api/health"]);
const MAX_UPSTREAM_RESPONSE_BYTES = 16 * 1024 * 1024;
const REQUEST_HEADER_BLOCKLIST = new Set([
  "connection",
  "host",
  "origin",
  "x-backend-token",
  "x-request-id",
  "x-installation-id",
  "x-npp-code",
  "x-actor-id",
  "x-actor-type",
  "x-actor-authentication"
]);

function json(res, statusCode, payload, requestId, origin = null, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    ...extraHeaders,
    ...corsHeaders(origin)
  });
  res.end(body);
}

function noContent(res, requestId, origin = null) {
  res.writeHead(204, {
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    ...corsHeaders(origin)
  });
  res.end();
}

function healthData(config) {
  return {
    service: config.service,
    installationConfigured: Boolean(config.installationId && config.nppCode),
    providerConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
    authBoundary: config.authMode
  };
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
    const finish = () => {
      if (finished) return false;
      finished = true;
      resolve();
      return true;
    };

    const upstream = http.request(
      {
        host: config.internalHost,
        port: config.internalPort,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: upstreamHeaders(req, context, config)
      },
      (upstreamResponse) => {
        const chunks = [];
        let size = 0;

        upstreamResponse.on("data", (chunk) => {
          if (finished) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_UPSTREAM_RESPONSE_BYTES) {
            upstreamResponse.destroy();
            if (finish()) {
              writeNormalized(
                res,
                canonicalErrorPayload(
                  { code: "UPSTREAM_RESPONSE_INVALID", statusCode: 502 },
                  { requestId: context.requestId, receivedAt: context.receivedAt, status: 502 }
                ),
                context.requestId,
                origin
              );
            }
            return;
          }
          chunks.push(buffer);
        });

        upstreamResponse.on("end", () => {
          if (!finish()) return;
          const parsed = parseJsonPayload(Buffer.concat(chunks).toString("utf8"));
          if (!parsed.ok) {
            writeNormalized(
              res,
              canonicalErrorPayload(
                { code: "UPSTREAM_RESPONSE_INVALID", statusCode: 502 },
                { requestId: context.requestId, receivedAt: context.receivedAt, status: 502 }
              ),
              context.requestId,
              origin
            );
            return;
          }

          writeNormalized(
            res,
            normalizeApiPayload(parsed.value, {
              status: upstreamResponse.statusCode || 502,
              requestId: context.requestId,
              receivedAt: context.receivedAt
            }),
            context.requestId,
            origin
          );
        });
      }
    );

    upstream.setTimeout(config.upstreamTimeoutMs, () => {
      upstream.destroy(new Error("legacy_upstream_timeout"));
    });

    upstream.on("error", (error) => {
      if (!finish()) return;
      if (!res.headersSent) {
        writeNormalized(
          res,
          canonicalErrorPayload(error, {
            requestId: context.requestId,
            receivedAt: context.receivedAt,
            status: error.message === "legacy_upstream_timeout" ? 504 : 502
          }),
          context.requestId,
          origin
        );
      } else {
        res.destroy(error);
      }
    });

    req.on("aborted", () => upstream.destroy(new Error("client_aborted")));
    req.pipe(upstream);
  });
}

export function createFoundationGateway(config) {
  return http.createServer(async (req, res) => {
    const requestId = normalizeRequestId(req.headers["x-request-id"]);
    const receivedAt = new Date().toISOString();
    req.headers["x-request-id"] = requestId;
    let origin = null;

    try {
      origin = resolveCorsOrigin(req, config.corsOrigins);
      const url = new URL(req.url || "/", `http://${req.headers.host || `${config.publicHost}:${config.publicPort}`}`);

      if (req.method === "OPTIONS") {
        noContent(res, requestId, origin);
        return;
      }

      if (PUBLIC_HEALTH_PATHS.has(url.pathname)) {
        json(
          res,
          200,
          canonicalSuccessPayload(healthData(config), { requestId, receivedAt }),
          requestId,
          origin
        );
        return;
      }

      authenticateProxy(req, config);
      const context = buildRequestContext(req, config);
      req.foundationContext = context;

      const orderApi = await handleOrderApi(req, url, context, config);
      if (orderApi) {
        writeNormalized(
          res,
          normalizeApiPayload(orderApi.payload, {
            status: orderApi.statusCode,
            requestId: context.requestId,
            receivedAt: context.receivedAt
          }),
          context.requestId,
          origin
        );
        return;
      }

      const routeApi = await handleRouteApi(req, url, context, config);
      if (routeApi) {
        writeNormalized(
          res,
          normalizeApiPayload(routeApi.payload, {
            status: routeApi.statusCode,
            requestId: context.requestId,
            receivedAt: context.receivedAt
          }),
          context.requestId,
          origin
        );
        return;
      }

      const transitional = await handleTransitionalApi(req, url, context, config);
      if (transitional) {
        writeNormalized(
          res,
          normalizeApiPayload(transitional.payload, {
            status: transitional.statusCode,
            requestId: context.requestId,
            receivedAt: context.receivedAt
          }),
          context.requestId,
          origin
        );
        return;
      }

      await proxyToLegacy(req, res, url, context, origin, config);
    } catch (error) {
      const status = Number(error?.statusCode || 500);
      const retryAfterSeconds = Number(error?.publicDetails?.retryAfterSeconds || 0);
      const extraHeaders =
        error?.code === "idempotency_in_progress" && Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0
          ? { "Retry-After": String(Math.min(retryAfterSeconds, 300)) }
          : {};

      writeNormalized(
        res,
        canonicalErrorPayload(error, { requestId, receivedAt, status }),
        requestId,
        origin,
        extraHeaders
      );
    }
  });
}

export function waitForLegacyHealth(config, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(
        {
          host: config.internalHost,
          port: config.internalPort,
          path: "/api/health",
          timeout: 500
        },
        (response) => {
          response.resume();
          if ((response.statusCode || 500) < 500) {
            resolve();
            return;
          }
          retry();
        }
      );
      request.on("timeout", () => request.destroy());
      request.on("error", retry);
    };

    const retry = () => {
      if (Date.now() >= deadline) {
        reject(new Error("legacy_backend_not_ready"));
        return;
      }
      setTimeout(check, 75);
    };

    check();
  });
}
