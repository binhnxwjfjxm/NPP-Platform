import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSuccessEnvelope } from '@npp/contracts';
import { loadConfig, getSanitizedConfig } from './config.js';
import { closePool, getPool, queryReady } from './db/pool.js';
import { sendJson, sendSuccess, sendError, sendNoContent } from './http-utils.js';
import {
  authenticateRequest,
  createAnonymousPrincipal,
  createRequestContext,
  requirePermission,
  PERMISSIONS,
  safeRequestContext,
} from './request-context.js';
import { resolveRequestId } from '@npp/shared-utils';
import {
  createPostgresIdempotencyStore,
  executeRequestWithIdempotency,
  readJsonBody,
} from './idempotency.js';
import {
  withAuditOutboxTransaction,
  buildAuditRecord,
  insertAuditRecord,
  buildOutboxEvent,
  insertOutboxEvent,
} from './audit-outbox.js';
import { createOptionalR2StorageAdapter } from './storage/r2-adapter.js';
import { executeR2ContractOperation } from './storage/r2-contract.js';
import { handleOrganizationRoutes } from './routes/organization.js';
import { handleEmployeeRoutes } from './routes/employees.js';
import { handleAccessUserRoutes } from './routes/access-users.js';
import { handleAccessRoutes } from './routes/access.js';
import { handleCustomerRoutes } from './routes/customers.js';
import { handleSupplierRoutes } from './routes/suppliers.js';
import { handleProductRoutes } from './routes/products.js';

const __filename = fileURLToPath(import.meta.url);
const CORS_ALLOWED_HEADERS = 'authorization, content-type, idempotency-key, x-request-id';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

async function defaultAuditOutboxMutation({ client, requestContext, payload }) {
  const auditRecord = buildAuditRecord({
    requestContext,
    action: 'core.audit_outbox_test',
    resourceType: 'audit-outbox-test',
    afterData: payload,
    metadata: {},
  });

  const outboxEvent = buildOutboxEvent({
    requestContext,
    aggregateType: 'core.audit_outbox_test',
    aggregateId: requestContext.requestId,
    eventType: 'core.audit_outbox.test.created',
    eventVersion: 1,
    payload,
    metadata: {},
  });

  await insertAuditRecord(client, auditRecord);
  await insertOutboxEvent(client, outboxEvent);
  return { auditId: auditRecord.auditId, eventId: outboxEvent.eventId };
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function defaultIdempotencyTestHandler({ payload, requestContext, requestId, receivedAt }) {
  return {
    statusCode: 200,
    contentType: 'application/json',
    requestId,
    body: createSuccessEnvelope({
      status: 'processed',
      payload,
      actorId: requestContext.actorId,
      installationId: requestContext.installationId,
    }, requestId, receivedAt),
  };
}

export function createCoreApiServer(options = {}) {
  const runtimeConfig = options.config ?? loadConfig();
  const allowedOrigins = new Set(runtimeConfig.corsOrigins);
  const queryDb = options.queryFn ?? (() => queryReady(runtimeConfig));
  const authenticate = options.authenticateRequest ?? authenticateRequest;
  const createContext = options.createRequestContext ?? createRequestContext;
  const authorize = options.requirePermission ?? requirePermission;
  const anonymousPrincipal = options.createAnonymousPrincipal ?? createAnonymousPrincipal;
  const idempotencyStore = options.idempotencyStore
    ?? createPostgresIdempotencyStore(options.idempotencyAdapter ?? getPool(runtimeConfig));
  const idempotencyTestHandler = options.idempotencyTestHandler ?? defaultIdempotencyTestHandler;
  const auditOutboxAdapter = options.auditOutboxAdapter ?? getPool(runtimeConfig);
  const auditOutboxMutation = options.auditOutboxMutation ?? defaultAuditOutboxMutation;
  const storageAdapter = options.storageAdapter ?? createOptionalR2StorageAdapter(runtimeConfig);
  const storageContractOperation = options.storageContractOperation ?? executeR2ContractOperation;

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
    const allowedMethods = new Map([
      ['/health/live', new Set(['GET'])],
      ['/health/ready', new Set(['GET'])],
      ['/api/config', new Set(['GET'])],
      ['/health/authenticated', new Set(['GET'])],
      ['/api/idempotency-test', new Set(['POST'])],
      ['/api/audit-outbox-test', new Set(['POST'])],
    ]);
    if (runtimeConfig.r2ContractRouteEnabled) {
      allowedMethods.set('/api/storage/r2-test', new Set(['POST']));
    }

    if (req.method === 'OPTIONS' && allowedMethods.has(url.pathname)) {
      if (!origin) {
        sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), requestId, receivedAt);
        return;
      }
      const requestedMethod = String(req.headers['access-control-request-method'] ?? '').toUpperCase();
      if (requestedMethod && !allowedMethods.get(url.pathname).has(requestedMethod)) {
        sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), requestId, receivedAt);
        return;
      }
      const routeMethods = [...allowedMethods.get(url.pathname), 'OPTIONS'].join(', ');
      res.setHeader('Access-Control-Allow-Methods', routeMethods);
      res.setHeader('Access-Control-Allow-Headers', CORS_ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      sendNoContent(res, 204, requestId);
      return;
    }

    if (allowedMethods.has(url.pathname) && !allowedMethods.get(url.pathname).has(req.method)) {
      sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), requestId, receivedAt);
      return;
    }

    if (url.pathname === '/api/storage/r2-test' && !runtimeConfig.r2ContractRouteEnabled) {
      sendError(res, createError('NOT_FOUND', 'Route not found', {}, false, 404), requestId, receivedAt);
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

    if (url.pathname === '/api/idempotency-test') {
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
      const permission = authorize(requestContext, PERMISSIONS.coreIdempotencyTestWrite);
      if (!permission.ok) {
        sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
        return;
      }
      try {
        const executionResult = await executeRequestWithIdempotency({
          idempotencyStore,
          req,
          requestContext,
          requestId,
          receivedAt,
          route: '/api/idempotency-test',
          payload,
          onProcess: () => idempotencyTestHandler({ payload, requestContext, requestId, receivedAt }),
        });
        res.setHeader('Cache-Control', 'no-store');
        sendJson(
          res,
          executionResult.response.statusCode,
          executionResult.response.body,
          executionResult.response.requestId ?? requestId,
          executionResult.response.contentType,
        );
      } catch {
        sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503), requestId, receivedAt);
      }
      return;
    }

    if (url.pathname === '/api/audit-outbox-test') {
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
      const permission = authorize(requestContext, PERMISSIONS.coreAuditOutboxTestWrite);
      if (!permission.ok) {
        sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
        return;
      }
      try {
        const result = await withAuditOutboxTransaction({
          adapter: auditOutboxAdapter,
          mutate: async (client, helpers) => auditOutboxMutation({
            client,
            requestContext,
            requestId,
            payload,
            ...helpers,
          }),
        });
        res.setHeader('Cache-Control', 'no-store');
        sendSuccess(res, { auditId: result.auditId, eventId: result.eventId }, requestId, receivedAt);
      } catch {
        sendError(res, createError('AUDIT_OUTBOX_TRANSACTION_FAILED', 'Audit/outbox transaction failed', {}, true, 503), requestId, receivedAt);
      }
      return;
    }

    if (url.pathname === '/api/storage/r2-test') {
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
      const permission = authorize(requestContext, PERMISSIONS.coreStorageR2TestWrite);
      if (!permission.ok) {
        sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
        return;
      }
      try {
        const executionResult = await executeRequestWithIdempotency({
          idempotencyStore,
          req,
          requestContext,
          requestId,
          receivedAt,
          route: '/api/storage/r2-test',
          payload,
          onProcess: async () => {
            const result = await storageContractOperation({
              storageAdapter,
              auditAdapter: auditOutboxAdapter,
              requestContext,
              payload,
            });
            return {
              statusCode: 200,
              contentType: 'application/json',
              requestId,
              body: createSuccessEnvelope(result, requestId, receivedAt),
            };
          },
        });
        res.setHeader('Cache-Control', 'no-store');
        sendJson(
          res,
          executionResult.response.statusCode,
          executionResult.response.body,
          executionResult.response.requestId ?? requestId,
          executionResult.response.contentType,
        );
      } catch (error) {
        if (typeof error?.code === 'string' && error.code.startsWith('STORAGE_')) {
          sendError(
            res,
            createError(
              error.code,
              error.publicMessage ?? 'Storage operation failed',
              error.details ?? {},
              Boolean(error.retryable),
              error.statusCode ?? 500,
            ),
            requestId,
            receivedAt,
          );
        } else {
          sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503), requestId, receivedAt);
        }
      }
      return;
    }

    const routeContext = {
      config: runtimeConfig,
      idempotencyStore,
      getPool: () => getPool(runtimeConfig),
      executeRequestWithIdempotency,
      requestId,
      receivedAt,
      authenticate,
      authorize,
      PERMISSIONS,
      createContext,
    };

    if (await handleEmployeeRoutes(req, res, routeContext)) return;
    if (await handleAccessUserRoutes(req, res, routeContext)) return;
    if (await handleAccessRoutes(req, res, routeContext)) return;
    if (await handleOrganizationRoutes(req, res, routeContext)) return;
    if (await handleCustomerRoutes(req, res, routeContext)) return;
    if (await handleSupplierRoutes(req, res, routeContext)) return;
    if (await handleProductRoutes(req, res, routeContext)) return;

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
