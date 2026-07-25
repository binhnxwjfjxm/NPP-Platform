/**
 * Organization and warehouse routes handler
 * Handles branches, warehouses, and warehouse location endpoints
 */

import { createSuccessEnvelope, createErrorEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError, sendNoContent } from '../http-utils.js';
import { readJsonBody } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, buildOutboxEvent, insertOutboxEvent, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as branchService from '../services/branch.js';
import * as warehouseService from '../services/warehouse.js';
import * as locationService from '../services/location.js';
import * as branchRepo from '../db/repositories/branch.js';
import * as warehouseRepo from '../db/repositories/warehouse.js';
import * as locationRepo from '../db/repositories/location.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

/**
 * Helper to parse URL and extract path params
 */
function parseUrl(pathname) {
  const match = pathname.match(/^\/api\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  return { resource: match[1], id: match[2] };
}

/**
 * Handler for GET /api/branches
 * List all branches for current installation
 */
async function handleGetBranches(req, res, { requestContext, idempotencyStore, getPool, requestId, receivedAt, authenticate, authorize, PERMISSIONS, createContext }) {
  const url = new URL(`http://localhost${req.url}`);
  const active = url.searchParams.get('active');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

  const pool = getPool();
  try {
    const result = await branchService.listBranches(pool, {
      installationId: requestContext.installationId,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
      limit,
      offset,
    });

    sendSuccess(res, result.branches, requestId, receivedAt);
  } catch (error) {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list branches', {}, true, 500), requestId, receivedAt);
  }
}

/**
 * Handler for POST /api/branches
 * Create a new branch (idempotent)
 */
async function handlePostBranches(req, res, { requestContext, idempotencyStore, getPool, idempotencyKey, executeRequestWithIdempotency, requestId, receivedAt }) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/branches',
      payload,
      onProcess: async () => {
        let branch;
        await withAuditOutboxTransaction(pool, async (client) => {
          const serviceResult = await branchService.createBranch(client, {
            installationId: requestContext.installationId,
            payload,
            createdBy: requestContext.actorId,
          });

          if (!serviceResult.ok) {
            return {
              statusCode: serviceResult.code === 'DUPLICATE_CODE' ? 409 : 400,
              contentType: 'application/json',
              requestId,
              body: createErrorEnvelope({
                code: serviceResult.code,
                message: serviceResult.message,
                details: {},
                retryable: serviceResult.retryable ?? false,
              }, requestId, receivedAt),
            };
          }

          branch = serviceResult.branch;

          // Create audit record
          const auditRecord = buildAuditRecord({
            requestContext,
            action: 'create',
            resourceType: 'branch',
            resourceId: branch.id,
            afterData: branch,
            metadata: { code: branch.code },
          });

          await insertAuditRecord(client, auditRecord);

          // Optionally create outbox event
          const outboxEvent = buildOutboxEvent({
            requestContext,
            aggregateType: 'branch',
            aggregateId: branch.id,
            eventType: 'branch.created',
            eventVersion: 1,
            payload: branch,
            metadata: { code: branch.code },
          });

          await insertOutboxEvent(client, outboxEvent);
        });

        if (branch) {
          return {
            statusCode: 201,
            contentType: 'application/json',
            requestId,
            body: createSuccessEnvelope(branch, requestId, receivedAt),
          };
        }
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
  } catch {
    sendError(
      res,
      createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503),
      requestId,
      receivedAt,
    );
  }
}

/**
 * Handler for GET /api/branches/:id
 */
async function handleGetBranchById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Branch not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await branchService.getBranch(pool, { id: parsed.id });
    if (!result.ok) {
      sendError(res, createError('NOT_FOUND', 'Branch not found', {}, false, 404), requestId, receivedAt);
      return;
    }

    sendSuccess(res, result.branch, requestId, receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch branch', {}, true, 500), requestId, receivedAt);
  }
}

/**
 * Handler for PATCH /api/branches/:id
 * Update branch or change active status
 */
async function handlePatchBranchById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Branch not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    await withAuditOutboxTransaction(pool, async (client) => {
      if (typeof payload.isActive === 'boolean') {
        // Change active status
        const result = await branchService.updateBranchStatus(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          isActive: payload.isActive,
          updatedBy: requestContext.actorId,
        });

        if (!result.ok) {
          const statusCode = result.code === 'NOT_FOUND' ? 404 : result.code === 'CANNOT_DEACTIVATE' ? 409 : 400;
          sendError(res, createError(result.code, result.message, {}, result.retryable ?? false, statusCode), requestId, receivedAt);
          return;
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: payload.isActive ? 'activate' : 'deactivate',
          resourceType: 'branch',
          resourceId: result.branch.id,
          afterData: result.branch,
          metadata: { code: result.branch.code },
        });

        await insertAuditRecord(client, auditRecord);
        sendSuccess(res, result.branch, requestId, receivedAt);
      } else {
        // Update branch details
        const result = await branchService.updateBranch(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!result.ok) {
          const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
          sendError(res, createError(result.code, result.message, {}, false, statusCode), requestId, receivedAt);
          return;
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'branch',
          resourceId: result.branch.id,
          afterData: result.branch,
          metadata: { code: result.branch.code },
        });

        await insertAuditRecord(client, auditRecord);
        sendSuccess(res, result.branch, requestId, receivedAt);
      }
    });
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update branch', {}, true, 500), requestId, receivedAt);
  }
}

/**
 * Route handler dispatcher for organization endpoints
 * Performs authentication and authorization before delegating to specific handlers
 */
export async function handleOrganizationRoutes(req, res, options) {
  const { pathname } = new URL(`http://localhost${req.url}`);
  const { authenticate, authorize, createContext, PERMISSIONS, requestId, receivedAt } = options;

  // Check if this is an organization route
  if (!pathname.startsWith('/api/branches') && !pathname.startsWith('/api/warehouses') && !pathname.startsWith('/api/warehouse-locations')) {
    return false;
  }

  // Perform authentication
  const authResult = authenticate(req, options.config);
  if (!authResult.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), requestId, receivedAt);
    return true;
  }

  // Create request context
  const requestContext = createContext({
    config: options.config,
    principal: authResult.principal,
    requestId,
    receivedAt,
  });

  // Check permissions based on method and resource
  const method = req.method.toUpperCase();
  const isWrite = method === 'POST' || method === 'PATCH';
  
  if (pathname.startsWith('/api/branches')) {
    const requiredPermission = isWrite ? PERMISSIONS.coreBranchWrite : PERMISSIONS.coreBranchRead;
    const authCheck = authorize(requestContext, requiredPermission);
    if (!authCheck.ok) {
      sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
      return true;
    }
  } else if (pathname.startsWith('/api/warehouses')) {
    const requiredPermission = isWrite ? PERMISSIONS.coreWarehouseWrite : PERMISSIONS.coreWarehouseRead;
    const authCheck = authorize(requestContext, requiredPermission);
    if (!authCheck.ok) {
      sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
      return true;
    }
  } else if (pathname.startsWith('/api/warehouse-locations')) {
    const requiredPermission = isWrite ? PERMISSIONS.coreWarehouseLocationWrite : PERMISSIONS.coreWarehouseLocationRead;
    const authCheck = authorize(requestContext, requiredPermission);
    if (!authCheck.ok) {
      sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), requestId, receivedAt);
      return true;
    }
  }

  // Set config for handlers
  options.config = options.config || {};

  // Dispatch to specific handlers
  if (pathname.startsWith('/api/branches')) {
    if (method === 'GET' && pathname === '/api/branches') {
      await handleGetBranches(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'POST' && pathname === '/api/branches') {
      await handlePostBranches(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'GET' && /^\/api\/branches\/[^/]+$/.test(pathname)) {
      await handleGetBranchById(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'PATCH' && /^\/api\/branches\/[^/]+$/.test(pathname)) {
      await handlePatchBranchById(req, res, { ...options, requestContext });
      return true;
    }
  }

  if (pathname.startsWith('/api/warehouses')) {
    if (method === 'GET' && pathname === '/api/warehouses') {
      await handleGetWarehouses(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'POST' && pathname === '/api/warehouses') {
      await handlePostWarehouses(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'GET' && /^\/api\/warehouses\/[^/]+$/.test(pathname)) {
      await handleGetWarehouseById(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'PATCH' && /^\/api\/warehouses\/[^/]+$/.test(pathname)) {
      await handlePatchWarehouseById(req, res, { ...options, requestContext });
      return true;
    }
  }

  if (pathname.startsWith('/api/warehouse-locations')) {
    if (method === 'GET' && pathname === '/api/warehouse-locations') {
      await handleGetLocations(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'POST' && pathname === '/api/warehouse-locations') {
      await handlePostLocations(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'GET' && /^\/api\/warehouse-locations\/[^/]+$/.test(pathname)) {
      await handleGetLocationById(req, res, { ...options, requestContext });
      return true;
    }
    if (method === 'PATCH' && /^\/api\/warehouse-locations\/[^/]+$/.test(pathname)) {
      await handlePatchLocationById(req, res, { ...options, requestContext });
      return true;
    }
  }

  return false; // Not handled
}

// ============================================================
// WAREHOUSE HANDLERS
// ============================================================

async function handleGetWarehouses(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const url = new URL(`http://localhost${req.url}`);
  const branchId = url.searchParams.get('branchId');
  const active = url.searchParams.get('active');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

  const pool = getPool();
  try {
    const result = await warehouseService.listWarehouses(pool, {
      installationId: requestContext.installationId,
      branchId,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
      limit,
      offset,
    });

    sendSuccess(res, result.warehouses, requestId, receivedAt);
  } catch (error) {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list warehouses', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePostWarehouses(req, res, { requestContext, idempotencyStore, getPool, executeRequestWithIdempotency, requestId, receivedAt }) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/warehouses',
      payload,
      onProcess: async () => {
        let warehouse;
        await withAuditOutboxTransaction(pool, async (client) => {
          const serviceResult = await warehouseService.createWarehouse(client, {
            installationId: requestContext.installationId,
            payload,
            createdBy: requestContext.actorId,
          });

          if (!serviceResult.ok) {
            return {
              statusCode: (serviceResult.code === 'DUPLICATE_CODE' || serviceResult.code === 'BRANCH_INACTIVE') ? 409 : 400,
              contentType: 'application/json',
              requestId,
              body: createErrorEnvelope({
                code: serviceResult.code,
                message: serviceResult.message,
                details: {},
                retryable: serviceResult.retryable ?? false,
              }, requestId, receivedAt),
            };
          }

          warehouse = serviceResult.warehouse;

          const auditRecord = buildAuditRecord({
            requestContext,
            action: 'create',
            resourceType: 'warehouse',
            resourceId: warehouse.id,
            afterData: warehouse,
            metadata: { code: warehouse.code },
          });

          await insertAuditRecord(client, auditRecord);

          const outboxEvent = buildOutboxEvent({
            requestContext,
            aggregateType: 'warehouse',
            aggregateId: warehouse.id,
            eventType: 'warehouse.created',
            eventVersion: 1,
            payload: warehouse,
            metadata: { code: warehouse.code },
          });

          await insertOutboxEvent(client, outboxEvent);
        });

        if (warehouse) {
          return {
            statusCode: 201,
            contentType: 'application/json',
            requestId,
            body: createSuccessEnvelope(warehouse, requestId, receivedAt),
          };
        }
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
  } catch {
    sendError(
      res,
      createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503),
      requestId,
      receivedAt,
    );
  }
}

async function handleGetWarehouseById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Warehouse not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await warehouseService.getWarehouse(pool, { id: parsed.id });
    if (!result.ok) {
      sendError(res, createError('NOT_FOUND', 'Warehouse not found', {}, false, 404), requestId, receivedAt);
      return;
    }

    sendSuccess(res, result.warehouse, requestId, receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch warehouse', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePatchWarehouseById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Warehouse not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    await withAuditOutboxTransaction(pool, async (client) => {
      if (typeof payload.isActive === 'boolean') {
        const result = await warehouseService.updateWarehouseStatus(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          isActive: payload.isActive,
          updatedBy: requestContext.actorId,
        });

        if (!result.ok) {
          const statusCode = result.code === 'NOT_FOUND' ? 404 : result.code === 'CANNOT_DEACTIVATE' ? 409 : 400;
          sendError(res, createError(result.code, result.message, {}, result.retryable ?? false, statusCode), requestId, receivedAt);
          return;
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: payload.isActive ? 'activate' : 'deactivate',
          resourceType: 'warehouse',
          resourceId: result.warehouse.id,
          afterData: result.warehouse,
          metadata: { code: result.warehouse.code },
        });

        await insertAuditRecord(client, auditRecord);
        sendSuccess(res, result.warehouse, requestId, receivedAt);
      } else {
        const result = await warehouseService.updateWarehouse(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!result.ok) {
          const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
          sendError(res, createError(result.code, result.message, {}, false, statusCode), requestId, receivedAt);
          return;
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'warehouse',
          resourceId: result.warehouse.id,
          afterData: result.warehouse,
          metadata: { code: result.warehouse.code },
        });

        await insertAuditRecord(client, auditRecord);
        sendSuccess(res, result.warehouse, requestId, receivedAt);
      }
    });
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update warehouse', {}, true, 500), requestId, receivedAt);
  }
}

// ============================================================
// WAREHOUSE LOCATION HANDLERS
// ============================================================

async function handleGetLocations(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const url = new URL(`http://localhost${req.url}`);
  const warehouseId = url.searchParams.get('warehouseId');
  const active = url.searchParams.get('active');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);

  const pool = getPool();
  try {
    const result = await locationService.listWarehouseLocations(pool, {
      installationId: requestContext.installationId,
      warehouseId,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
      limit,
      offset,
    });

    sendSuccess(res, result.locations, requestId, receivedAt);
  } catch (error) {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list locations', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePostLocations(req, res, { requestContext, idempotencyStore, getPool, executeRequestWithIdempotency, requestId, receivedAt }) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/warehouse-locations',
      payload,
      onProcess: async () => {
        let location;
        await withAuditOutboxTransaction(pool, async (client) => {
          const serviceResult = await locationService.createWarehouseLocation(client, {
            installationId: requestContext.installationId,
            payload,
            createdBy: requestContext.actorId,
          });

          if (!serviceResult.ok) {
            return {
              statusCode: (serviceResult.code === 'DUPLICATE_CODE' || serviceResult.code === 'WAREHOUSE_INACTIVE') ? 409 : 400,
              contentType: 'application/json',
              requestId,
              body: createErrorEnvelope({
                code: serviceResult.code,
                message: serviceResult.message,
                details: {},
                retryable: serviceResult.retryable ?? false,
              }, requestId, receivedAt),
            };
          }

          location = serviceResult.location;

          const auditRecord = buildAuditRecord({
            requestContext,
            action: 'create',
            resourceType: 'warehouse_location',
            resourceId: location.id,
            afterData: location,
            metadata: { code: location.code },
          });

          await insertAuditRecord(client, auditRecord);

          const outboxEvent = buildOutboxEvent({
            requestContext,
            aggregateType: 'warehouse_location',
            aggregateId: location.id,
            eventType: 'warehouse_location.created',
            eventVersion: 1,
            payload: location,
            metadata: { code: location.code },
          });

          await insertOutboxEvent(client, outboxEvent);
        });

        if (location) {
          return {
            statusCode: 201,
            contentType: 'application/json',
            requestId,
            body: createSuccessEnvelope(location, requestId, receivedAt),
          };
        }
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
  } catch {
    sendError(
      res,
      createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503),
      requestId,
      receivedAt,
    );
  }
}

async function handleGetLocationById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Location not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await locationService.getWarehouseLocation(pool, { id: parsed.id });
    if (!result.ok) {
      sendError(res, createError('NOT_FOUND', 'Location not found', {}, false, 404), requestId, receivedAt);
      return;
    }

    sendSuccess(res, result.location, requestId, receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch location', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePatchLocationById(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const parsed = parseUrl(req.url.split('?')[0]);
  if (!parsed || !parsed.id) {
    sendError(res, createError('NOT_FOUND', 'Location not found', {}, false, 404), requestId, receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    await withAuditOutboxTransaction(pool, async (client) => {
      if (typeof payload.isActive === 'boolean') {
        const result = await locationService.updateWarehouseLocationStatus(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          isActive: payload.isActive,
          updatedBy: requestContext.actorId,
        });

        if (!result.ok) {
          const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
          sendError(res, createError(result.code, result.message, {}, result.retryable ?? false, statusCode), requestId, receivedAt);
          return;
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: payload.isActive ? 'activate' : 'deactivate',
          resourceType: 'warehouse_location',
          resourceId: result.location.id,
          afterData: result.location,
          metadata: { code: result.location.code },
        });

        await insertAuditRecord(client, auditRecord);
        sendSuccess(res, result.location, requestId, receivedAt);
      } else {
        const result = await locationService.updateWarehouseLocation(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!result.ok) {
          const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
          sendError(res, createError(result.code, result.message, {}, false, statusCode), requestId, receivedAt);
          return;
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'warehouse_location',
          resourceId: result.location.id,
          afterData: result.location,
          metadata: { code: result.location.code },
        });

        await insertAuditRecord(client, auditRecord);
        sendSuccess(res, result.location, requestId, receivedAt);
      }
    });
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update location', {}, true, 500), requestId, receivedAt);
  }
}
