import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getSanitizedConfig } from './config.js';
import { closePool, queryReady } from './db/pool.js';
import { sendSuccess, sendError } from './http-utils.js';
import { buildAuthContext, extractBearerToken, tokenMatches } from '@npp/auth-context';
import { createRequestId } from '@npp/shared-utils';

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

  return http.createServer(async (req, res) => {
    const requestId = req.headers['x-request-id'] || createRequestId('req');
    const receivedAt = new Date().toISOString();
    const origin = req.headers.origin;

    if (origin && !allowedOrigins.has(origin)) {
      sendError(res, createError('CORS_ORIGIN_NOT_ALLOWED', 'Origin not allowed', {}, false, 403), requestId, receivedAt);
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const knownPath = ['/health/live', '/health/ready', '/api/config'].includes(url.pathname);
    if (knownPath && req.method !== 'GET') {
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
        sendError(
          res,
          createError('DATABASE_READY_CHECK_FAILED', 'Database readiness check failed', {}, true, 503),
          requestId,
          receivedAt,
        );
      }
      return;
    }

    if (url.pathname === '/api/config') {
      const candidate = extractBearerToken(req.headers.authorization);
      if (!tokenMatches(candidate, runtimeConfig.backendApiToken)) {
        sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), requestId, receivedAt);
        return;
      }

      const authContext = buildAuthContext({
        requestId,
        installationId: runtimeConfig.installationId,
        roles: ['viewer'],
      });
      sendSuccess(res, { config: getSanitizedConfig(runtimeConfig), authContext }, requestId, receivedAt);
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
