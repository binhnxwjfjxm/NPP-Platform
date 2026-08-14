import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import { createOptionalR2StorageAdapter } from '../storage/r2-adapter.js';
import * as customerMediaRepository from '../db/repositories/customer-media.js';
import {
  getAssignedDriverTrip,
  listAssignedDriverTrips,
  recordDriverDeliveryAttempt,
} from '../services/logistics-driver-delivery.js';
import { getAssignedDriverTripCommercial } from '../services/logistics-driver-commercial.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_MEDIA_VIEW_TTL_SECONDS = 300;

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'PERMISSION_DENIED' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.endsWith('_QUERY_FAILED') || code.endsWith('_TRANSACTION_FAILED')) return 503;
  if (
    code.includes('CONFLICT')
    || code.includes('MISMATCH')
    || code.includes('IDEMPOTENCY')
    || code.includes('ALREADY')
    || code.includes('EXCEEDS')
  ) return 409;
  return 400;
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    const error = new Error('INVALID_QUERY_PARAMETER');
    error.code = 'INVALID_QUERY_PARAMETER';
    error.publicMessage = `Query parameter must be an integer between 0 and ${max}`;
    error.statusCode = 400;
    throw error;
  }
  return parsed;
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

async function authenticateDriver(req, res, options, permission) {
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
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(
      res,
      apiError('PERMISSION_DENIED', 'Permission denied', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return requestContext;
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

async function readDriverCustomerMedia(res, options, requestContext, tripId, customerId) {
  if (!UUID_PATTERN.test(String(tripId ?? '')) || !UUID_PATTERN.test(String(customerId ?? ''))) {
    sendError(
      res,
      apiError('INVALID_DELIVERY_CUSTOMER_MEDIA_PATH', 'Trip or customer id is invalid', {}, false, 400),
      options.requestId,
      options.receivedAt,
    );
    return;
  }

  const tripResult = await getAssignedDriverTrip(options.getPool(), { requestContext, tripId });
  if (!tripResult.ok) {
    sendServiceError(res, tripResult, options);
    return;
  }
  const belongsToTrip = (tripResult.trip.stops ?? []).some(
    (stop) => String(stop.customerId) === String(customerId),
  );
  if (!belongsToTrip) {
    sendServiceError(
      res,
      { ok: false, code: 'DELIVERY_CUSTOMER_NOT_FOUND', message: 'Customer is not part of this assigned trip' },
      options,
    );
    return;
  }

  const mediaResult = await customerMediaRepository.listReadyCustomerMedia(options.getPool(), {
    installationId: requestContext.installationId,
    customerId,
  });
  if (!mediaResult.ok) {
    sendServiceError(res, mediaResult, options);
    return;
  }
  if (mediaResult.media.length === 0) {
    writeSuccess(res, { media: [], maxPhotos: mediaResult.maxPhotos }, options);
    return;
  }

  const storage = createOptionalR2StorageAdapter(options.config);
  if (!storage) {
    sendError(
      res,
      apiError('CUSTOMER_MEDIA_STORAGE_UNAVAILABLE', 'Kho ảnh khách hàng chưa sẵn sàng', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return;
  }
  const ttl = Math.min(CUSTOMER_MEDIA_VIEW_TTL_SECONDS, options.config.r2PresignedUrlMaxSeconds);
  const media = await Promise.all(mediaResult.media.map(async (item) => {
    const signed = await storage.createPresignedGetUrl({
      installationId: requestContext.installationId,
      key: item.objectKey,
      expiresIn: ttl,
    });
    return customerMediaRepository.customerMediaPublic(item, signed.url);
  }));
  writeSuccess(res, { media, maxPhotos: mediaResult.maxPhotos }, options);
}

export async function handleLogisticsDriverRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  if (pathname !== '/api/logistics/driver/trips'
      && !pathname.startsWith('/api/logistics/driver/trips/')) return false;

  const method = String(req.method ?? 'GET').toUpperCase();
  try {
    if (method === 'GET') {
      const requestContext = await authenticateDriver(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryTripDriverRead,
      );
      if (!requestContext) return true;

      if (pathname === '/api/logistics/driver/trips') {
        const result = await listAssignedDriverTrips(options.getPool(), {
          requestContext,
          limit: parseInteger(url.searchParams.get('limit'), 100, 500),
          offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
        });
        if (!result.ok) sendServiceError(res, result, options);
        else writeSuccess(res, { driver: result.driver, trips: result.trips }, options);
        return true;
      }

      const mediaMatch = pathname.match(
        /^\/api\/logistics\/driver\/trips\/([^/]+)\/customers\/([^/]+)\/media$/,
      );
      if (mediaMatch) {
        await readDriverCustomerMedia(res, options, requestContext, mediaMatch[1], mediaMatch[2]);
        return true;
      }

      const detailMatch = pathname.match(/^\/api\/logistics\/driver\/trips\/([^/]+)$/);
      if (!detailMatch) {
        sendError(
          res,
          apiError('NOT_FOUND', 'Route not found', {}, false, 404),
          options.requestId,
          options.receivedAt,
        );
        return true;
      }
      const result = await getAssignedDriverTripCommercial(options.getPool(), {
        requestContext,
        tripId: detailMatch[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, { driver: result.driver, trip: result.trip }, options);
      return true;
    }

    const attemptMatch = pathname.match(
      /^\/api\/logistics\/driver\/trips\/([^/]+)\/assignments\/([^/]+)\/attempts$/,
    );
    if (method === 'POST' && attemptMatch) {
      const requestContext = await authenticateDriver(
        req,
        res,
        options,
        options.PERMISSIONS.coreDeliveryAttemptRecord,
      );
      if (!requestContext) return true;
      let payload;
      try {
        payload = await readJsonBody(req);
      } catch (error) {
        sendError(
          res,
          apiError(error.code, error.publicMessage, {}, false, error.statusCode),
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
      const result = await recordDriverDeliveryAttempt({
        adapter: options.getPool(),
        requestContext,
        tripId: attemptMatch[1],
        assignmentId: attemptMatch[2],
        idempotencyKey: idempotency.key,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else writeSuccess(res, result, options);
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
    if (typeof error?.statusCode === 'number' && typeof error?.publicMessage === 'string') {
      sendError(
        res,
        apiError(error.code, error.publicMessage, {}, false, error.statusCode),
        options.requestId,
        options.receivedAt,
      );
      return true;
    }
    console.error(JSON.stringify({
      event: 'logistics_driver_route_unexpected_error',
      requestId: options.requestId,
      name: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
    }));
    sendError(
      res,
      apiError('DELIVERY_DRIVER_ROUTE_FAILED', 'Delivery data is temporarily unavailable', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }
}
