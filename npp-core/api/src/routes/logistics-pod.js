import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey } from '../idempotency.js';
import { createOptionalR2StorageAdapter } from '../storage/r2-adapter.js';
import { createStorageError, STORAGE_ERROR_CODES } from '../storage/errors.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import {
  attachDriverProof,
  listDispatcherProofs,
  listDriverProofs,
} from '../services/logistics-proof-of-delivery.js';

const MAX_POD_REQUEST_BYTES = 16 * 1024 * 1024;

function storageUnavailable() {
  throw createStorageError(STORAGE_ERROR_CODES.disabled, 'Photo storage is not configured', {
    retryable: true,
    statusCode: 503,
  });
}

const STORAGE_UNAVAILABLE_ADAPTER = Object.freeze({
  putObject: storageUnavailable,
  createPresignedGetUrl: storageUnavailable,
  async deleteObject() {
    return Object.freeze({ deleted: false });
  },
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('TOO_LARGE')) return 413;
  if (code.startsWith('STORAGE_')
      || code.includes('STORAGE_UNAVAILABLE')
      || code.endsWith('_QUERY_FAILED')
      || code.endsWith('_TRANSACTION_FAILED')) return 503;
  if (code.startsWith('INVALID_') || code === 'MISSING_IDEMPOTENCY_KEY') return 400;
  if (code.includes('CONFLICT') || code.includes('MISMATCH')) return 409;
  return 400;
}

function writeSuccess(res, data, options) {
  res.setHeader('Cache-Control', 'no-store');
  sendJson(
    res,
    200,
    createSuccessEnvelope(data, options.requestId, options.receivedAt),
    options.requestId,
  );
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(
      result.code,
      result.message,
      result.details ?? {},
      Boolean(result.retryable),
      statusFor(result.code),
    ),
    options.requestId,
    options.receivedAt,
  );
}

async function readLimitedJson(req) {
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw Object.assign(new Error('invalid_json_body'), {
        code: 'INVALID_JSON_BODY',
        publicMessage: 'Request body must be valid JSON',
        statusCode: 400,
      });
    }
    if (parsed > MAX_POD_REQUEST_BYTES) {
      throw Object.assign(new Error('request_body_too_large'), {
        code: 'REQUEST_BODY_TOO_LARGE',
        publicMessage: 'POD request body is too large',
        statusCode: 413,
      });
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > MAX_POD_REQUEST_BYTES) {
      throw Object.assign(new Error('request_body_too_large'), {
        code: 'REQUEST_BODY_TOO_LARGE',
        publicMessage: 'POD request body is too large',
        statusCode: 413,
      });
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_shape');
    return value;
  } catch {
    throw Object.assign(new Error('invalid_json_body'), {
      code: 'INVALID_JSON_BODY',
      publicMessage: 'Request body must be valid JSON',
      statusCode: 400,
    });
  }
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch {
    return {
      ok: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

function withWarehouseScopes(requestContext, scopedWarehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(scopedWarehouseIds),
    territoryIds: Object.freeze([...(requestContext.scopes?.territoryIds ?? [])]),
  });
  return Object.freeze({
    ...requestContext,
    scopes,
    authContext: requestContext.authContext
      ? Object.freeze({ ...requestContext.authContext, scopes })
      : requestContext.authContext,
  });
}

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: true,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

async function authenticate(req, res, options, permissions, expandBootstrapScope = false) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(
      res,
      apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  let context = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (permissions.some((permission) => !options.authorize(context, permission).ok)) {
    sendError(
      res,
      apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  if (expandBootstrapScope) context = await ensureWarehouseScopes(options.getPool(), context);
  return context;
}

function resolveStorageAdapter(options) {
  if (Object.prototype.hasOwnProperty.call(options, 'storageAdapter')) {
    return options.storageAdapter ?? STORAGE_UNAVAILABLE_ADAPTER;
  }
  try {
    return createOptionalR2StorageAdapter(options.config) ?? STORAGE_UNAVAILABLE_ADAPTER;
  } catch {
    return STORAGE_UNAVAILABLE_ADAPTER;
  }
}

export async function handleLogisticsPodRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const driverMatch = pathname.match(
    /^\/api\/logistics\/driver\/trips\/([^/]+)\/assignments\/([^/]+)\/attempts\/([^/]+)\/pod$/,
  );
  const dispatcherMatch = pathname.match(
    /^\/api\/logistics\/trips\/([^/]+)\/attempts\/([^/]+)\/pod$/,
  );
  if (!driverMatch && !dispatcherMatch) return false;

  const method = String(req.method ?? 'GET').toUpperCase();
  const storageAdapter = resolveStorageAdapter(options);
  try {
    if (driverMatch && method === 'GET') {
      const requestContext = await authenticate(
        req,
        res,
        options,
        [options.PERMISSIONS.coreDeliveryTripDriverRead, options.PERMISSIONS.corePodRead],
      );
      if (!requestContext) return true;
      const result = await listDriverProofs({
        adapter: options.getPool(),
        storageAdapter,
        requestContext,
        tripId: driverMatch[1],
        assignmentId: driverMatch[2],
        attemptId: driverMatch[3],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, { proofs: result.proofs }, options);
      return true;
    }

    if (driverMatch && method === 'POST') {
      const requestContext = await authenticate(
        req,
        res,
        options,
        [options.PERMISSIONS.coreDeliveryTripDriverRead, options.PERMISSIONS.corePodAttach],
      );
      if (!requestContext) return true;
      let payload;
      try {
        payload = await readLimitedJson(req);
      } catch (error) {
        sendError(
          res,
          apiError(error.code, error.publicMessage, {}, false, error.statusCode),
          options.requestId,
          options.receivedAt,
        );
        return true;
      }
      if ('driverId' in payload || 'employeeId' in payload || 'installationId' in payload) {
        sendError(
          res,
          apiError('UNTRUSTED_POD_IDENTITY', 'POD identity is server-owned', {}, false, 400),
          options.requestId,
          options.receivedAt,
        );
        return true;
      }
      const idempotency = requireIdempotency(req);
      if (!idempotency.ok) {
        sendError(
          res,
          apiError(idempotency.code, idempotency.message, {}, false, 400),
          options.requestId,
          options.receivedAt,
        );
        return true;
      }
      const result = await attachDriverProof({
        adapter: options.getPool(),
        storageAdapter,
        requestContext,
        tripId: driverMatch[1],
        assignmentId: driverMatch[2],
        attemptId: driverMatch[3],
        idempotencyKey: idempotency.key,
        payload,
        maxObjectBytes: options.config.r2MaxObjectBytes,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result, options);
      return true;
    }

    if (dispatcherMatch && method === 'GET') {
      const requestContext = await authenticate(
        req,
        res,
        options,
        [options.PERMISSIONS.coreDeliveryTripRead, options.PERMISSIONS.corePodRead],
        true,
      );
      if (!requestContext) return true;
      const result = await listDispatcherProofs({
        adapter: options.getPool(),
        storageAdapter,
        requestContext,
        tripId: dispatcherMatch[1],
        attemptId: dispatcherMatch[2],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, { proofs: result.proofs }, options);
      return true;
    }

    sendError(
      res,
      apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405),
      options.requestId,
      options.receivedAt,
    );
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'logistics_pod_route_failed',
      requestId: options.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    }));
    sendError(
      res,
      apiError('POD_ROUTE_FAILED', 'POD is temporarily unavailable', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }
}

export const logisticsPodRouteInternals = Object.freeze({
  MAX_POD_REQUEST_BYTES,
  STORAGE_UNAVAILABLE_ADAPTER,
  readLimitedJson,
  requireIdempotency,
  resolveStorageAdapter,
});
