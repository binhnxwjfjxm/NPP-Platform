import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getSanitizedConfig } from './config.js';
import { closePool, queryReady } from './db/pool.js';
import { sendSuccess, sendError, sendNoContent } from './http-utils.js';
import { authenticateRequest, createAnonymousPrincipal, createRequestContext, requirePermission, PERMISSIONS, safeRequestContext } from './request-context.js';
import { resolveRequestId } from '@npp/shared-utils';

const __filename = fileURLToPath(import.meta.url);
const CORS_ALLOWED_METHODS = 'GET, OPTIONS';
const CORS_ALLOWED_HEADERS = 'authorization, content-type, x-request-id';

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

  return http.createServer(async (req, res) => {
    const receivedAt = new Date().toISOString();
    const origin = req.headers.origin;
    const requestId = resolveRequestId(req.headers['x-request-id'], 'req');
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
    const knownPublicPath = ['/health/live', '/health/ready'];
    const knownProtectedPath = ['/api/config', '/health/authenticated'];
    const knownPath = new Set([...knownPublicPath, ...knownProtectedPath]);

    if (req.method === 'OPTIONS' && knownPath.has(url.pathname)) {
      if (!origin) {
        sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), requestId, receivedAt);
        return;
      }
      res.setHeader('Access-Control-Allow-Methods', CORS_ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      sendNoContent(res, 204, requestId);
      return;
    }

    if (knownPath.has(url.pathname) && req.method !== 'GET') {
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
        res.setHeader('WWW-Authenticate', 'Bearer');
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

      res.setHeader('Cache-Control', 'no-store');
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
        res.setHeader('WWW-Authenticate', 'Bearer');
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

      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, {
        status: 'authenticated',
        actorId: requestContext.actorId,
        installationId: requestContext.installationId,
        requestId: requestContext.requestId,
      }, requestId, receivedAt);
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
