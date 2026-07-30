/**
 * Organization and warehouse routes handler
 * Handles branches, warehouses, and warehouse location endpoints
 */

import { createSuccessEnvelope, createErrorEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError, sendNoContent } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as branchService from '../services/branch.js';
import * as warehouseService from '../services/warehouse.js';
import * as locationService from '../services/location.js';
import * as branchRepo from '../db/repositories/branch.js';
import * as warehouseRepo from '../db/repositories/warehouse.js';
import * as locationRepo from '../db/repositories/location.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUrl(pathname) {
  const match = pathname.match(/^\/api\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  return { resource: match[1], id: match[2] };
}

function parseBooleanParam(value) {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
    code: 'INVALID_QUERY_PARAMETER',
    publicMessage: 'Query parameter must be true or false',
    statusCode: 400,
  });
}

function parsePositiveIntParam(value, defaultValue, maxValue) {
  if (value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between 0 and ${maxValue}`,
      statusCode: 400,
    });
  }
  return parsed;
}

function requireIdempotencyKey(req, requestId, receivedAt) {
  const rawKey = req.headers['idempotency-key'];
  if (rawKey === undefined || rawKey === null) {
    return {
      statusCode: 400,
      body: createErrorEnvelope(
        { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required', statusCode: 400 },
        requestId,
        receivedAt,
      ),
    };
  }
  try {
    normalizeIdempotencyKey(rawKey);
    return null;
  } catch (error) {
    return {
      statusCode: 400,
      body: createErrorEnvelope(
        { code: error.code, message: 'Idempotency-Key must be 1-128 characters and contain only letters, numbers, dots, underscores, or hyphens', statusCode: error.statusCode },
        requestId,
        receivedAt,
      ),
    };
  }
}

function requireExpectedUpdatedAt(payload) {
  if (!payload || typeof payload.expectedUpdatedAt !== 'string' || !payload.expectedUpdatedAt.trim()) {
    return {
      statusCode: 400,
      error: {
        code: 'MISSING_EXPECTED_UPDATED_AT',
        message: 'expectedUpdatedAt is required for patch operations',
        statusCode: 400,
      },
    };
  }
  return null;
}

/**
 * Handler for GET /api/branches
 * List all branches for current installation
 */
async function handleGetBranches(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const url = new URL(`http://localhost${req.url}`);
  let active, limit, offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    if (error.statusCode) {
      sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to parse query parameters', {}, true, 500), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await branchService.listBranches(pool, {
      installationId: requestContext.installationId,
      active,
      limit,
      offset,
    });

    sendSuccess(res, result.branches, requestId, receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list branches', {}, true, 500), requestId, receivedAt);
  }
}

/**
 * Handler for POST /api/branches
 * Create a new branch (idempotent)
 */
async function handlePostBranches(req, res, { requestContext, idempotencyStore, getPool, executeRequestWithIdempotency, requestId, receivedAt }) {
  const missingKey = requireIdempotencyKey(req, requestId, receivedAt);
  if (missingKey) {
    sendError(res, createError(missingKey.body.error?.code ?? 'MISSING_IDEMPOTENCY_KEY', missingKey.body.error?.message ?? 'Idempotency-Key header is required', {}, false, 400), requestId, receivedAt);
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
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/branches',
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: pool,
          mutate: async (client) => {
            const serviceResult = await branchService.createBranch(client, {
              installationId: requestContext.installationId,
              payload,
              createdBy: requestContext.actorId,
            });

            if (!serviceResult.ok) {
              return { skipAudit: true, serviceResult };
            }

            const branch = serviceResult.branch;
            const auditRecord = buildAuditRecord({
              requestContext,
              action: 'create',
              resourceType: 'branch',
              resourceId: branch.id,
              afterData: branch,
              metadata: { code: branch.code },
            });
            await insertAuditRecord(client, auditRecord);
            return { branch };
          },
        });

        if (transactionResult?.skipAudit) {
          const serviceResult = transactionResult.serviceResult;
          return {
            statusCode: statusForServiceResult(serviceResult),
            contentType: 'application/json',
            requestId,
            body: createErrorEnvelope({
              code: serviceResult.code,
              message: serviceResult.message,
              details: serviceResult.details ?? {},
              retryable: serviceResult.retryable ?? false,
            }, requestId, receivedAt),
          };
        }

        const branch = transactionResult.branch;

        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId,
          body: createSuccessEnvelope(branch, requestId, receivedAt),
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
    const result = await branchService.getBranch(pool, { installationId: requestContext.installationId, id: parsed.id });
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

  const expectedUpdatedAtError = requireExpectedUpdatedAt(payload);
  if (expectedUpdatedAtError) {
    sendError(res, createError(expectedUpdatedAtError.error.code, expectedUpdatedAtError.error.message, {}, false, expectedUpdatedAtError.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const result = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        if (typeof payload.isActive === 'boolean') {
          const statusResult = await branchService.updateBranchStatus(client, {
            id: parsed.id,
            installationId: requestContext.installationId,
            isActive: payload.isActive,
            updatedBy: requestContext.actorId,
            expectedUpdatedAt: payload.expectedUpdatedAt,
          });

          if (!statusResult.ok) {
            throw Object.assign(new Error('BRANCH_STATUS_UPDATE_FAILED'), { serviceResult: statusResult });
          }

          const auditRecord = buildAuditRecord({
            requestContext,
            action: payload.isActive ? 'activate' : 'deactivate',
            resourceType: 'branch',
            resourceId: statusResult.branch.id,
            beforeData: statusResult.beforeData || null,
            afterData: statusResult.branch,
            metadata: { code: statusResult.branch.code },
          });

          await insertAuditRecord(client, auditRecord);
          return { branch: statusResult.branch };
        }

        const updateResult = await branchService.updateBranch(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!updateResult.ok) {
          throw Object.assign(new Error('BRANCH_UPDATE_FAILED'), { serviceResult: updateResult });
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'branch',
          resourceId: updateResult.branch.id,
          beforeData: updateResult.beforeData || null,
          afterData: updateResult.branch,
          metadata: { code: updateResult.branch.code },
        });

        await insertAuditRecord(client, auditRecord);
        return { branch: updateResult.branch };
      },
    });

    sendSuccess(res, result.branch, requestId, receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      const result = error.serviceResult;
      const statusCode = statusForServiceResult(result);
      sendError(res, serviceResultError(result, statusCode), requestId, receivedAt);
      return;
    }

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

export { requireIdempotencyKey };

// ============================================================
// WAREHOUSE HANDLERS
// ============================================================

async function handleGetWarehouses(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const url = new URL(`http://localhost${req.url}`);
  const branchId = url.searchParams.get('branchId');
  let active, limit, offset;

  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    if (error.statusCode) {
      sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to parse query parameters', {}, true, 500), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await warehouseService.listWarehouses(pool, {
      installationId: requestContext.installationId,
      branchId,
      active,
      limit,
      offset,
    });

    if (!result.ok) {
      const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
      sendError(res, serviceResultError(result, statusCode), requestId, receivedAt);
      return;
    }

    sendSuccess(res, result.warehouses, requestId, receivedAt);
  } catch (error) {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list warehouses', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePostWarehouses(req, res, { requestContext, idempotencyStore, getPool, executeRequestWithIdempotency, requestId, receivedAt }) {
  const missingKey = requireIdempotencyKey(req, requestId, receivedAt);
  if (missingKey) {
    sendError(res, createError(missingKey.body.error?.code ?? 'MISSING_IDEMPOTENCY_KEY', missingKey.body.error?.message ?? 'Idempotency-Key header is required', {}, false, 400), requestId, receivedAt);
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
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/warehouses',
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: pool,
          mutate: async (client) => {
            const serviceResult = await warehouseService.createWarehouse(client, {
              installationId: requestContext.installationId,
              payload,
              createdBy: requestContext.actorId,
            });

            if (!serviceResult.ok) {
              return { skipAudit: true, serviceResult };
            }

            const warehouse = serviceResult.warehouse;
            const auditRecord = buildAuditRecord({
              requestContext,
              action: 'create',
              resourceType: 'warehouse',
              resourceId: warehouse.id,
              afterData: warehouse,
              metadata: { code: warehouse.code },
            });
            await insertAuditRecord(client, auditRecord);
            return { warehouse };
          },
        });

        if (transactionResult?.skipAudit) {
          const serviceResult = transactionResult.serviceResult;
          return {
            statusCode: statusForServiceResult(serviceResult),
            contentType: 'application/json',
            requestId,
            body: createErrorEnvelope({
              code: serviceResult.code,
              message: serviceResult.message,
              details: serviceResult.details ?? {},
              retryable: serviceResult.retryable ?? false,
            }, requestId, receivedAt),
          };
        }

        const warehouse = transactionResult.warehouse;
        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId,
          body: createSuccessEnvelope(warehouse, requestId, receivedAt),
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
    const result = await warehouseService.getWarehouse(pool, { installationId: requestContext.installationId, id: parsed.id });
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

  const expectedUpdatedAtError = requireExpectedUpdatedAt(payload);
  if (expectedUpdatedAtError) {
    sendError(res, createError(expectedUpdatedAtError.error.code, expectedUpdatedAtError.error.message, {}, false, expectedUpdatedAtError.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const result = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        if (typeof payload.isActive === 'boolean') {
          const statusResult = await warehouseService.updateWarehouseStatus(client, {
            id: parsed.id,
            installationId: requestContext.installationId,
            isActive: payload.isActive,
            updatedBy: requestContext.actorId,
            expectedUpdatedAt: payload.expectedUpdatedAt,
          });

          if (!statusResult.ok) {
            throw Object.assign(new Error('WAREHOUSE_STATUS_UPDATE_FAILED'), { serviceResult: statusResult });
          }

          const auditRecord = buildAuditRecord({
            requestContext,
            action: payload.isActive ? 'activate' : 'deactivate',
            resourceType: 'warehouse',
            resourceId: statusResult.warehouse.id,
            beforeData: statusResult.beforeData || null,
            afterData: statusResult.warehouse,
            metadata: { code: statusResult.warehouse.code },
          });

          await insertAuditRecord(client, auditRecord);
          return { warehouse: statusResult.warehouse };
        }

        const updateResult = await warehouseService.updateWarehouse(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!updateResult.ok) {
          throw Object.assign(new Error('WAREHOUSE_UPDATE_FAILED'), { serviceResult: updateResult });
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'warehouse',
          resourceId: updateResult.warehouse.id,
          beforeData: updateResult.beforeData || null,
          afterData: updateResult.warehouse,
          metadata: { code: updateResult.warehouse.code },
        });

        await insertAuditRecord(client, auditRecord);
        return { warehouse: updateResult.warehouse };
      },
    });

    sendSuccess(res, result.warehouse, requestId, receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      const result = error.serviceResult;
      const statusCode = statusForServiceResult(result);
      sendError(res, serviceResultError(result, statusCode), requestId, receivedAt);
      return;
    }

    sendError(res, createError('INTERNAL_ERROR', 'Failed to update warehouse', {}, true, 500), requestId, receivedAt);
  }
}

// ============================================================
// WAREHOUSE LOCATION HANDLERS
// ============================================================

async function handleGetLocations(req, res, { requestContext, getPool, requestId, receivedAt }) {
  const url = new URL(`http://localhost${req.url}`);
  const warehouseId = url.searchParams.get('warehouseId');
  let active, limit, offset;

  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    if (error.statusCode) {
      sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), requestId, receivedAt);
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to parse query parameters', {}, true, 500), requestId, receivedAt);
    return;
  }

  const pool = getPool();
  try {
    const result = await locationService.listWarehouseLocations(pool, {
      installationId: requestContext.installationId,
      warehouseId,
      active,
      limit,
      offset,
    });

    if (!result.ok) {
      const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
      sendError(res, serviceResultError(result, statusCode), requestId, receivedAt);
      return;
    }

    sendSuccess(res, result.locations, requestId, receivedAt);
  } catch (error) {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list locations', {}, true, 500), requestId, receivedAt);
  }
}

async function handlePostLocations(req, res, { requestContext, idempotencyStore, getPool, executeRequestWithIdempotency, requestId, receivedAt }) {
  const missingKey = requireIdempotencyKey(req, requestId, receivedAt);
  if (missingKey) {
    sendError(res, createError(missingKey.body.error?.code ?? 'MISSING_IDEMPOTENCY_KEY', missingKey.body.error?.message ?? 'Idempotency-Key header is required', {}, false, 400), requestId, receivedAt);
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
    const executionResult = await executeRequestWithIdempotency({
      idempotencyStore,
      req,
      requestContext,
      requestId,
      receivedAt,
      route: '/api/warehouse-locations',
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: pool,
          mutate: async (client) => {
            const serviceResult = await locationService.createWarehouseLocation(client, {
              installationId: requestContext.installationId,
              payload,
              createdBy: requestContext.actorId,
            });

            if (!serviceResult.ok) {
              return { skipAudit: true, serviceResult };
            }

            const location = serviceResult.location;
            const auditRecord = buildAuditRecord({
              requestContext,
              action: 'create',
              resourceType: 'warehouse_location',
              resourceId: location.id,
              afterData: location,
              metadata: { code: location.code },
            });
            await insertAuditRecord(client, auditRecord);
            return { location };
          },
        });

        if (transactionResult?.skipAudit) {
          const serviceResult = transactionResult.serviceResult;
          return {
            statusCode: statusForServiceResult(serviceResult),
            contentType: 'application/json',
            requestId,
            body: createErrorEnvelope({
              code: serviceResult.code,
              message: serviceResult.message,
              details: serviceResult.details ?? {},
              retryable: serviceResult.retryable ?? false,
            }, requestId, receivedAt),
          };
        }

        const location = transactionResult.location;
        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId,
          body: createSuccessEnvelope(location, requestId, receivedAt),
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
    const result = await locationService.getWarehouseLocation(pool, { installationId: requestContext.installationId, id: parsed.id });
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

  const expectedUpdatedAtError = requireExpectedUpdatedAt(payload);
  if (expectedUpdatedAtError) {
    sendError(res, createError(expectedUpdatedAtError.error.code, expectedUpdatedAtError.error.message, {}, false, expectedUpdatedAtError.statusCode), requestId, receivedAt);
    return;
  }

  const pool = getPool();

  try {
    const result = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        if (typeof payload.isActive === 'boolean') {
          const statusResult = await locationService.updateWarehouseLocationStatus(client, {
            id: parsed.id,
            installationId: requestContext.installationId,
            isActive: payload.isActive,
            updatedBy: requestContext.actorId,
            expectedUpdatedAt: payload.expectedUpdatedAt,
          });

          if (!statusResult.ok) {
            throw Object.assign(new Error('LOCATION_STATUS_UPDATE_FAILED'), { serviceResult: statusResult });
          }

          const auditRecord = buildAuditRecord({
            requestContext,
            action: payload.isActive ? 'activate' : 'deactivate',
            resourceType: 'warehouse_location',
            resourceId: statusResult.location.id,
            beforeData: statusResult.beforeData || null,
            afterData: statusResult.location,
            metadata: { code: statusResult.location.code },
          });

          await insertAuditRecord(client, auditRecord);
          return { location: statusResult.location };
        }

        const updateResult = await locationService.updateWarehouseLocation(client, {
          id: parsed.id,
          installationId: requestContext.installationId,
          payload,
          updatedBy: requestContext.actorId,
        });

        if (!updateResult.ok) {
          throw Object.assign(new Error('LOCATION_UPDATE_FAILED'), { serviceResult: updateResult });
        }

        const auditRecord = buildAuditRecord({
          requestContext,
          action: 'update',
          resourceType: 'warehouse_location',
          resourceId: updateResult.location.id,
          beforeData: updateResult.beforeData || null,
          afterData: updateResult.location,
          metadata: { code: updateResult.location.code },
        });

        await insertAuditRecord(client, auditRecord);
        return { location: updateResult.location };
      },
    });

    sendSuccess(res, result.location, requestId, receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      const result = error.serviceResult;
      const statusCode = result.code === 'NOT_FOUND' ? 404 : 400;
      sendError(res, serviceResultError(result, statusCode), requestId, receivedAt);
      return;
    }

    sendError(res, createError('INTERNAL_ERROR', 'Failed to update location', {}, true, 500), requestId, receivedAt);
  }
}
