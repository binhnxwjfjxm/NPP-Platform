import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRequestId } from '@npp/shared-utils';
import { loadConfig } from './config.js';
import { closePool, getPool } from './db/pool.js';
import { createPostgresIdempotencyStore, executeRequestWithIdempotency } from './idempotency.js';
import {
  authenticateRequest as authenticateServiceRequest,
  createRequestContext,
  requirePermission,
  PERMISSIONS,
} from './request-context.js';
import { createCoreApiServer } from './server.js';
import { createCustomerPortalAuthenticator } from './customer-portal-auth.js';
import { handleCustomerPortalRoutes } from './routes/customer-portal.js';
import { loadInternalWorkforceAuthConfig } from './internal-workforce-config.js';
import { createInternalWorkforceAuthenticator } from './internal-workforce-auth.js';
import { handleInternalWorkforceAuthRoutes } from './routes/internal-workforce-auth.js';

const __filename = fileURLToPath(import.meta.url);
const RETRYABLE_ERROR_CODES = new Set(['40001', '40P01', '57P01', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

function closeHttpServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

export function resolveCustomerPortalRuntimeConfig(config, env = process.env) {
  const explicitHost = String(env?.HOST ?? '').trim();
  if (config.nodeEnv === 'production' && !explicitHost && config.host === '127.0.0.1') {
    return Object.freeze({ ...config, host: '0.0.0.0' });
  }
  return config;
}

function unexpectedPortalResponse(error, requestId, pathName) {
  const code = typeof error?.code === 'string' ? error.code : null;
  const retryable = error?.retryable === true || (code ? RETRYABLE_ERROR_CODES.has(code) : false);
  console.error(JSON.stringify({
    event: 'customer_portal_request_error',
    requestId,
    path: pathName,
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error ?? 'unknown'),
      code,
    },
  }));
  return {
    statusCode: retryable ? 503 : 500,
    error: {
      code: 'CUSTOMER_PORTAL_UNAVAILABLE',
      message: 'Customer Portal is temporarily unavailable.',
      details: {},
      retryable,
    },
  };
}

function sendInternalAuthUnavailable(res, requestId, receivedAt) {
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    error: {
      code: 'INTERNAL_AUTH_UNAVAILABLE',
      message: 'Internal authentication is temporarily unavailable.',
      details: {},
      retryable: true,
    },
    requestId,
    receivedAt,
  }));
}

export function createCustomerPortalAwareServer(options = {}) {
  const loadedConfig = options.config ?? loadConfig();
  const env = options.env ?? process.env;
  const runtimeConfig = resolveCustomerPortalRuntimeConfig(loadedConfig, env);
  const pool = options.pool ?? getPool(runtimeConfig);
  const internalAuthConfig = options.internalAuthConfig ?? loadInternalWorkforceAuthConfig(env);
  const internalAuth = options.internalAuth ?? createInternalWorkforceAuthenticator({
    config: internalAuthConfig,
    pool,
  });
  const authenticate = (req, config) => req.internalWorkforceAuthResult
    ?? authenticateServiceRequest(req, config);
  const baseServer = createCoreApiServer({ ...options, config: runtimeConfig, authenticateRequest: authenticate });
  const baseHandler = baseServer.listeners('request')[0];
  const idempotencyStore = options.idempotencyStore
    ?? createPostgresIdempotencyStore(options.idempotencyAdapter ?? pool);
  const portalAuth = options.customerPortalAuth ?? createCustomerPortalAuthenticator({ env });
  const createContext = options.createRequestContext ?? createRequestContext;
  const authorize = options.requirePermission ?? requirePermission;

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/customer-portal')) {
      const receivedAt = new Date().toISOString();
      const requestId = resolveRequestId(req.headers['x-request-id'], 'req');
      try {
        await handleCustomerPortalRoutes(req, res, {
          config: runtimeConfig,
          customerPortalAuth: portalAuth,
          idempotencyStore,
          executeRequestWithIdempotency,
          createContext,
          getPool: () => pool,
          requestId,
          receivedAt,
        });
      } catch (error) {
        const response = unexpectedPortalResponse(error, requestId, url.pathname);
        if (!res.headersSent) {
          res.statusCode = response.statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ error: response.error, requestId, receivedAt }));
        } else if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    const receivedAt = new Date().toISOString();
    const requestId = resolveRequestId(req.headers['x-request-id'], 'req');
    let internalAuthResult = null;
    if (internalAuthConfig.enabled) {
      try {
        internalAuthResult = await internalAuth.resolveRequest(req, {
          installationId: runtimeConfig.installationId,
        });
      } catch {
        sendInternalAuthUnavailable(res, requestId, receivedAt);
        return;
      }
    }
    req.internalWorkforceAuthResult = internalAuthResult;

    if (url.pathname === '/api/internal-auth' || url.pathname.startsWith('/api/internal-auth/')) {
      await handleInternalWorkforceAuthRoutes(req, res, {
        config: runtimeConfig,
        internalAuthConfig,
        internalAuth,
        internalAuthResult,
        authenticate,
        authorize,
        PERMISSIONS,
        createContext,
        getPool: () => pool,
        requestId,
        receivedAt,
      });
      return;
    }

    return baseHandler(req, res);
  });
}

export function startCustomerPortalAwareServer(options = {}) {
  const loadedConfig = options.config ?? loadConfig();
  const runtimeConfig = resolveCustomerPortalRuntimeConfig(loadedConfig, options.env ?? process.env);
  const server = createCustomerPortalAwareServer({ ...options, config: runtimeConfig });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(runtimeConfig.port, runtimeConfig.host, () => {
      server.off('error', reject);
      console.log(JSON.stringify({ event: 'npp_core_api_ready', host: runtimeConfig.host, port: runtimeConfig.port, installationId: runtimeConfig.installationId, customerPortal: true }));
      resolve(server);
    });
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMainModule) {
  const config = resolveCustomerPortalRuntimeConfig(loadConfig(), process.env);
  const server = await startCustomerPortalAwareServer({ config });
  let shuttingDown = false;
  const stop = async (signal) => {
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
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
