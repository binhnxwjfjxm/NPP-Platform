import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, getSanitizedConfig } from './config.js';
import { createPgPool, closePool, queryOne } from './db/pool.js';
import { sendSuccess, sendError } from './http-utils.js';
import { buildAuthContext, sanitizeToken } from '@npp/auth-context';
import { createRequestId } from '@npp/shared-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function normalizeConfig(configInput = {}) {
  const defaults = loadConfig();
  const corsOrigins = Array.isArray(configInput.corsOrigins)
    ? configInput.corsOrigins
    : Array.isArray(configInput.CORS_ORIGINS)
      ? configInput.CORS_ORIGINS
      : String(configInput.CORS_ORIGINS ?? defaults.corsOrigins ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);

  const source = {
    ...defaults,
    ...configInput,
    host: configInput.host ?? configInput.HOST ?? defaults.host,
    port: Number(configInput.port ?? configInput.PORT ?? defaults.port),
    databaseUrl: configInput.databaseUrl ?? configInput.DATABASE_URL ?? defaults.databaseUrl,
    databaseSslMode: configInput.databaseSslMode ?? configInput.DATABASE_SSL_MODE ?? defaults.databaseSslMode,
    backendApiToken: configInput.backendApiToken ?? configInput.BACKEND_API_TOKEN ?? defaults.backendApiToken,
    corsOrigins,
  };

  return source;
}

export function createCoreApiServer(options = {}) {
  const runtimeConfig = normalizeConfig(options.config ?? loadConfig());
  const allowedOrigins = new Set((options.corsOrigins ?? runtimeConfig.corsOrigins ?? []).map((origin) => origin.trim()).filter(Boolean));
  const queryDb = options.queryFn ?? (async () => queryOne(runtimeConfig));
  const pool = options.pool ?? createPgPool(runtimeConfig);

  return http.createServer(async (req, res) => {
    const requestId = req.headers['x-request-id'] || createRequestId('req');
    const receivedAt = new Date().toISOString();
    req.requestId = requestId;
    req.receivedAt = receivedAt;

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      sendError(res, createError('CORS_ORIGIN_NOT_ALLOWED', 'Origin not allowed', { origin }, false, 403), requestId, receivedAt);
      return;
    }

    if (req.url === '/health/live') {
      sendSuccess(res, { status: 'ok', pid: process.pid }, requestId, receivedAt);
      return;
    }

    if (req.url === '/health/ready') {
      try {
        await queryDb();
        sendSuccess(res, { status: 'ready' }, requestId, receivedAt);
      } catch (error) {
        sendError(
          res,
          createError('DATABASE_READY_CHECK_FAILED', 'Database readiness check failed', { provider: 'postgresql' }, false, 503),
          requestId,
          receivedAt,
        );
      }
      return;
    }

    if (req.url === '/api/config') {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      const sanitizedToken = sanitizeToken(token);

      if (!sanitizedToken || sanitizedToken !== runtimeConfig.backendApiToken) {
        sendError(
          res,
          createError('UNAUTHORIZED', 'Authorization required', { path: '/api/config' }, false, 401),
          requestId,
          receivedAt,
        );
        return;
      }

      const authContext = buildAuthContext({ requestId, installationId: 'default', roles: ['viewer'] });
      sendSuccess(res, { config: getSanitizedConfig(runtimeConfig), authContext }, requestId, receivedAt);
      return;
    }

    sendError(
      res,
      createError('NOT_FOUND', 'Route not found', { path: req.url }, false, 404),
      requestId,
      receivedAt,
    );
  });
}

export function startServer(options = {}) {
  const runtimeConfig = normalizeConfig(options.config ?? loadConfig());
  const server = createCoreApiServer({ ...options, config: runtimeConfig });

  return new Promise((resolve) => {
    server.listen(runtimeConfig.port, runtimeConfig.host, () => {
      console.log(`NPP Core API listening on http://${runtimeConfig.host}:${runtimeConfig.port}`);
      resolve(server);
    });
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const config = loadConfig();
  const stopServer = async (signal) => {
    console.log(`Received ${signal}. Shutting down gracefully.`);
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => stopServer('SIGTERM'));
  process.on('SIGINT', () => stopServer('SIGINT'));

  startServer({ config });
}
