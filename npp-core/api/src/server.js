import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSuccessEnvelope } from '@npp/contracts';
import { loadConfig, getSanitizedConfig } from './config.js';
import { closePool, getPool, queryReady } from './db/pool.js';
import { sendJson, sendSuccess, sendError } from './http-utils.js';
import { authenticateRequest, createAnonymousPrincipal, createRequestContext, requirePermission, PERMISSIONS, safeRequestContext } from './request-context.js';
import { createRequestId, normalizeRequestId } from '@npp/shared-utils';
import { createPostgresIdempotencyStore, executeRequestWithIdempotency, readJsonBody } from './idempotency.js';

const __filename = fileURLToPath(import.meta.url);

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function createCoreApiServer(options = {}) {
  const runtimeConfig = options.config ?? loadConfig();
  const allowedOrigins = new Set(runtimeConfig.corsOrigins);
  const queryDb = options.queryFn ?? (() => queryReady(runtimeConfig));
  const authenticate = options.authenticateRequest ?? authenticateRequest;
  const createContext = options.createRequestContext ?? createRequestContext;
  const authorize = options.requirePermission ?? requirePermission;
  const anonymousPrincipal = options.createAnonymousPrincipal ?? createAnonymousPrincipal;
  const idempotencyStore = options.idempotencyStore ?? createPostgresIdempotencyStore(options.idempotencyAdapter ?? getPool(runtimeConfig));

  return http.createServer(async (req, res) => {
    const receivedAt = new Date().toISOString();
    const origin = req.headers.origin;
    const requestId = normalizeRequestId(req.headers['x-request-id']);
    const anonymousContext = createContext({
      config: runtimeConfig,
      principal: anonymousPrincipal(),
      requestId,
      receivedAt,
    });

    req.requestContext = anonymousContext;

    if (origin && !allowedOrigins.has(origin)) {
      sendError(res, createError('CORS_ORIGIN_NOT_ALLOWED', 'Origin not allowed', {}, false, 403), requestId, receivedAt);
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    // Handle CORS preflight for protected GET endpoints
    if (req.method === 'OPTIONS' && url.pathname === '/api/config') {
      const originHeader = req.headers.origin;
      const acrMethod = req.headers['access-control-request-method'];
      if (originHeader && acrMethod && acrMethod.toUpperCase() === 'GET') {
        res.writeHead(204, {
          'access-control-allow-origin': originHeader,
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'authorization,x-request-id,content-type',
          'access-control-max-age': '600',
          'x-request-id': requestId,
        });
        res.end();
        return;
      }
    }
    const knownPublicPath = ['/health/live', '/health/ready'];
    const knownProtectedPath = ['/api/config', '/health/authenticated', '/api/idempotency-test'];
    const knownPath = new Set([...knownPublicPath, ...knownProtectedPath]);
    const allowedMethods = Object.freeze({
      '/health/live': new Set(['GET']),
      '/health/ready': new Set(['GET']),
      '/api/config': new Set(['GET']),
      '/health/authenticated': new Set(['GET']),
      '/api/idempotency-test': new Set(['POST']),
    });

    if (knownPath.has(url.pathname) && !allowedMethods[url.pathname].has(req.method)) {
      sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), requestId, receivedAt);
      return;
    }

    if (url.pathname === '/health/live') {
      sendSuccess(res, { status: 'ok', pid: process.pid }, requestId, receivedAt);
      return;
    }

    if (url.pathname === '/health/ready') {
      try {
        await queryDb();
        sendSuccess(res, { status: 'ready' }, requestId, receivedAt);
      } catch {
        sendError(res, createError('DATABASE_READY_CHECK_FAILED', 'Database readiness check failed', {}, true, 503), requestId, receivedAt);
      }
      return;
    }

    if (url.pathname === '/api/config') {
      const authResult = authenticate(req, runtimeConfig);
      if (!authResult.ok) {
        sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), requestId, receivedAt);
        return;
      }

      const requestContext = createContext({
        config: runtimeConfig,
        principal: authResult.principal,
        requestId,
        receivedAt,
      });
      req.requestContext = requestContext;

      const permission = authorize(requestContext, PERMISSIONS.coreConfigRead);
      if (!permission.ok) {
        sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
        return;
      }

      sendSuccess(res, {
        config: getSanitizedConfig(runtimeConfig),
        authContext: requestContext.authContext,
        requestContext: safeRequestContext(requestContext),
      }, requestId, receivedAt);
      return;
    }

    if (url.pathname === '/health/authenticated') {
      const authResult = authenticate(req, runtimeConfig);
      if (!authResult.ok) {
        sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), requestId, receivedAt);
        return;
      }

      const requestContext = createContext({
        config: runtimeConfig,
        principal: authResult.principal,
        requestId,
        receivedAt,
      });
      req.requestContext = requestContext;

      const permission = authorize(requestContext, PERMISSIONS.coreHealthAuthenticatedRead);
      if (!permission.ok) {
        sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
        return;
      }

      sendSuccess(res, {
        status: 'authenticated',
        actorId: requestContext.actorId,
        installationId: requestContext.installationId,
        requestId: requestContext.requestId,
      }, requestId, receivedAt);
      return;
    }

    if (url.pathname === '/api/idempotency-test') {
      const authResult = authenticate(req, runtimeConfig);
      if (!authResult.ok) {
        sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), requestId, receivedAt);
        return;
      }

      const requestContext = createContext({
        config: runtimeConfig,
        principal: authResult.principal,
        requestId,
        receivedAt,
      });
      req.requestContext = requestContext;

      const permission = authorize(requestContext, PERMISSIONS.coreIdempotencyTestWrite);
      if (!permission.ok) {
        sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
        return;
      }

      const payload = await readJsonBody(req);
      const executionResult = await executeRequestWithIdempotency({
        idempotencyStore,
        req,
        requestContext,
        requestId,
        receivedAt,
        route: '/api/idempotency-test',
        payload,
        onProcess: async () => {
          if (payload && payload.fail) {
            const err = new Error('Request failed');
            err.code = 'REQUEST_FAILED';
            err.publicMessage = 'Requested failure for test';
            err.statusCode = 500;
            throw err;
          }
          // Small artificial delay for the test scenario labeled 'concurrent'
          // to reliably exercise in-process concurrency handling.
          if (payload && payload.order === 'concurrent') {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          const nextBody = {
            status: 'processed',
            payload,
            actorId: requestContext.actorId,
            installationId: requestContext.installationId,
          };

          return {
            statusCode: 200,
            contentType: 'application/json',
            requestId,
            body: createSuccessEnvelope(nextBody, requestId, receivedAt),
          };
        },
      });

      if (!executionResult.response) {
        return;
      }

      sendJson(res, executionResult.response.statusCode, executionResult.response.body, executionResult.response.requestId ?? requestId);
      return;
    }

    sendError(res, createError('NOT_FOUND', 'Route not found', {}, false, 404), requestId, receivedAt);
  });
}

export function startServer(options = {}) {
  const runtimeConfig = options.config ?? loadConfig();
  const server = createCoreApiServer({ ...options, config: runtimeConfig });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtimeConfig.port, runtimeConfig.host, () => {
      server.off('error', reject);
      console.log(JSON.stringify({
        event: 'npp_core_api_ready',
        host: runtimeConfig.host,
        port: runtimeConfig.port,
        installationId: runtimeConfig.installationId,
      }));
      resolve(server);
    });
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const config = loadConfig();
  const server = await startServer({ config });
  let shuttingDown = false;

  const stopServer = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: 'npp_core_api_shutdown', signal }));
    try {
      await closeHttpServer(server);
      await closePool();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => stopServer('SIGTERM'));
  process.on('SIGINT', () => stopServer('SIGINT'));
}
