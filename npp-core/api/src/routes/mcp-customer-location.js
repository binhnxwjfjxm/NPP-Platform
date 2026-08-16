import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import { updateCustomerAddressLocation } from '../services/customer-location-sync.js';

const PATH = '/api/internal/mcp/customer-address-location';
const MCP_SALES_ROLE = 'mcp-sales-order-service';

function apiError(code, message, statusCode = 500, retryable = false, details = {}) {
  return { code, message, statusCode, retryable, details };
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message, result.statusCode ?? 400, Boolean(result.retryable), result.details ?? {}),
    options.requestId,
    options.receivedAt,
  );
}

function mcpSalesPrincipal(requestContext) {
  return requestContext?.sourceApp === 'mcp-plan-backend'
    && Array.isArray(requestContext.roles)
    && requestContext.roles.includes(MCP_SALES_ROLE);
}

function requireIdempotency(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key
      ? { ok: true, key }
      : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

function publicAddress(address) {
  return Object.freeze({
    customerId: address.customer_id,
    addressId: address.id,
    locationUrl: address.location_url ?? null,
    updatedAt: address.updated_at,
  });
}

export async function handleMcpCustomerLocationRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== PATH) return false;

  if (String(req.method ?? 'GET').toUpperCase() !== 'PATCH') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', 405), options.requestId, options.receivedAt);
    return true;
  }

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!mcpSalesPrincipal(requestContext)) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', 403), options.requestId, options.receivedAt);
    return true;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, error.statusCode), options.requestId, options.receivedAt);
    return true;
  }

  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(res, apiError(idempotency.code, idempotency.message, 400), options.requestId, options.receivedAt);
    return true;
  }

  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route: PATH,
      payload,
      onProcess: async () => {
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await updateCustomerAddressLocation(client, {
              installationId: requestContext.installationId,
              customerId: String(payload?.customerId ?? '').trim(),
              addressId: String(payload?.addressId ?? '').trim(),
              locationUrl: payload?.locationUrl ?? null,
              updatedBy: requestContext.actorId,
            });
            if (!result.ok) return { failed: true, result };
            if (result.changed === false) return { result, replayed: true };

            const address = publicAddress(result.address);
            const audit = buildAuditRecord({
              requestContext,
              action: 'customer.address.location.update_from_mcp',
              resourceType: 'customer_address',
              resourceId: result.address.id,
              beforeData: publicAddress(result.beforeData),
              afterData: address,
              metadata: { source: 'MCP' },
            });
            const outbox = buildOutboxEvent({
              requestContext,
              aggregateType: 'shared.customer_address',
              aggregateId: result.address.id,
              eventType: 'shared.customer_address.location_updated',
              eventVersion: 1,
              payload: address,
              metadata: { source: 'MCP' },
            });
            await insertAuditRecord(client, audit);
            await insertOutboxEvent(client, outbox);
            return {
              result,
              eventId: outbox.eventId,
              expectedAuditCount: 1,
              expectedOutboxCount: 1,
            };
          },
        });

        if (transaction.failed) {
          const error = apiError(
            transaction.result.code,
            transaction.result.message,
            transaction.result.statusCode ?? 400,
            Boolean(transaction.result.retryable),
            transaction.result.details ?? {},
          );
          return {
            statusCode: error.statusCode,
            contentType: 'application/json',
            requestId: options.requestId,
            body: createErrorEnvelope(error, options.requestId, options.receivedAt),
          };
        }
        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(publicAddress(transaction.result.address), options.requestId, options.receivedAt),
        };
      },
    });

    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: 'mcp_customer_location_sync_failed',
      requestId: options.requestId,
      code: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(
      res,
      apiError('MCP_CUSTOMER_LOCATION_SYNC_FAILED', 'Không thể cập nhật vị trí điểm bán lúc này.', 503, true),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}

export const mcpCustomerLocationInternals = Object.freeze({
  PATH,
  MCP_SALES_ROLE,
  mcpSalesPrincipal,
});
