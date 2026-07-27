import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as customerService from '../services/customer.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
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

function requireIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  }
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must be 1-128 characters and contain only letters, numbers, dots, underscores, or hyphens',
    };
  }
}

function serviceStatus(result) {
  if (['NOT_FOUND', 'GROUP_NOT_FOUND', 'EMPLOYEE_NOT_FOUND'].includes(result.code)) return 404;
  if (['DUPLICATE_CODE', 'CONFLICT', 'GROUP_INACTIVE', 'EMPLOYEE_INACTIVE', 'CUSTOMER_INACTIVE'].includes(result.code)) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    createError(result.code, result.message, {}, Boolean(result.retryable), serviceStatus(result)),
    context.requestId,
    context.receivedAt,
  );
}

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      createError(error.code, error.publicMessage, {}, false, error.statusCode),
      context.requestId,
      context.receivedAt,
    );
    return null;
  }
}

async function executeIdempotentCreate(req, res, context, {
  route,
  payload,
  create,
  resourceType,
  getResourceId,
  metadata,
}) {
  const keyResult = requireIdempotencyKey(req);
  if (!keyResult.ok) {
    sendError(res, createError(keyResult.code, keyResult.message, {}, false, 400), context.requestId, context.receivedAt);
    return;
  }

  try {
    const execution = await context.executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await create(client);
            if (!serviceResult.ok) return { serviceResult, skipAudit: true };
            const entity = serviceResult.entity;
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: 'create',
              resourceType,
              resourceId: getResourceId(entity),
              afterData: entity,
              metadata: metadata(entity),
            }));
            return { entity };
          },
        });

        if (transactionResult.skipAudit) {
          return {
            statusCode: serviceStatus(transactionResult.serviceResult),
            contentType: 'application/json',
            requestId: context.requestId,
            body: {
              error: {
                code: transactionResult.serviceResult.code,
                message: transactionResult.serviceResult.message,
                retryable: Boolean(transactionResult.serviceResult.retryable),
                details: {},
              },
              requestId: context.requestId,
              receivedAt: context.receivedAt,
            },
          };
        }

        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(transactionResult.entity, context.requestId, context.receivedAt),
        };
      },
    });

    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? context.requestId,
      execution.response.contentType,
    );
  } catch {
    sendError(
      res,
      createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503),
      context.requestId,
      context.receivedAt,
    );
  }
}

async function executePatch(res, context, {
  update,
  resourceType,
  getEntity,
  getAction,
  metadata,
}) {
  try {
    const transactionResult = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const serviceResult = await update(client);
        if (!serviceResult.ok) {
          throw Object.assign(new Error('CUSTOMER_MASTER_UPDATE_FAILED'), { serviceResult });
        }
        const entity = getEntity(serviceResult);
        if (serviceResult.changed === false) return { entity };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: getAction(serviceResult),
          resourceType,
          resourceId: entity.id,
          beforeData: serviceResult.beforeData ?? null,
          afterData: entity,
          metadata: metadata(entity),
        }));
        return { entity };
      },
    });
    sendSuccess(res, transactionResult.entity, context.requestId, context.receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      sendServiceError(res, error.serviceResult, context);
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update customer master data', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleListGroups(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active;
  let limit;
  let offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  try {
    const result = await customerService.listCustomerGroups(context.getPool(), {
      installationId: context.requestContext.installationId,
      search: url.searchParams.get('search'),
      active,
      limit,
      offset,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.groups, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customer groups', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetGroup(res, context, id) {
  try {
    const result = await customerService.getCustomerGroup(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.group, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch customer group', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateGroup(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/customer-groups',
    payload,
    create: async (client) => {
      const result = await customerService.createCustomerGroup(client, {
        installationId: context.requestContext.installationId,
        payload,
        createdBy: context.requestContext.actorId,
      });
      return result.ok ? { ok: true, entity: result.group } : result;
    },
    resourceType: 'customer_group',
    getResourceId: (group) => group.id,
    metadata: (group) => ({ code: group.code }),
  });
}

async function handlePatchGroup(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => customerService.updateCustomerGroup(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'customer_group',
    getEntity: (result) => result.group,
    getAction: (result) => result.action ?? 'update',
    metadata: (group) => ({ code: group.code }),
  });
}

async function handleListCustomers(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active;
  let limit;
  let offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  try {
    const result = await customerService.listCustomers(context.getPool(), {
      installationId: context.requestContext.installationId,
      search: url.searchParams.get('search'),
      active,
      groupId: url.searchParams.get('groupId'),
      limit,
      offset,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.customers, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customers', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetCustomer(res, context, id) {
  try {
    const result = await customerService.getCustomer(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.customer, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch customer', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateCustomer(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/customers',
    payload,
    create: async (client) => {
      const result = await customerService.createCustomer(client, {
        installationId: context.requestContext.installationId,
        payload,
        createdBy: context.requestContext.actorId,
      });
      return result.ok ? { ok: true, entity: result.customer } : result;
    },
    resourceType: 'customer',
    getResourceId: (customer) => customer.id,
    metadata: (customer) => ({ code: customer.code }),
  });
}

async function handlePatchCustomer(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => customerService.updateCustomer(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'customer',
    getEntity: (result) => result.customer,
    getAction: (result) => result.action ?? 'update',
    metadata: (customer) => ({ code: customer.code }),
  });
}

async function handleListAddresses(res, context, customerId) {
  try {
    const result = await customerService.listCustomerAddresses(context.getPool(), {
      installationId: context.requestContext.installationId,
      customerId,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.addresses, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customer addresses', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateAddress(req, res, context, customerId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: `/api/customers/${customerId}/addresses`,
    payload,
    create: async (client) => {
      const result = await customerService.createCustomerAddress(client, {
        installationId: context.requestContext.installationId,
        customerId,
        payload,
        createdBy: context.requestContext.actorId,
      });
      return result.ok ? { ok: true, entity: result.address } : result;
    },
    resourceType: 'customer_address',
    getResourceId: (address) => address.id,
    metadata: (address) => ({ customerId: address.customer_id, label: address.label }),
  });
}

async function handlePatchAddress(req, res, context, customerId, addressId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => customerService.updateCustomerAddress(client, {
      installationId: context.requestContext.installationId,
      customerId,
      addressId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'customer_address',
    getEntity: (result) => result.address,
    getAction: () => 'update',
    metadata: (address) => ({ customerId: address.customer_id, label: address.label }),
  });
}

export async function handleCustomerRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const isCustomerPath = pathname === '/api/customers'
    || pathname.startsWith('/api/customers/')
    || pathname === '/api/customer-groups'
    || pathname.startsWith('/api/customer-groups/');
  if (!isCustomerPath) return false;

  const authResult = options.authenticate(req, options.config);
  if (!authResult.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = options.createContext({
    config: options.config,
    principal: authResult.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const method = String(req.method || 'GET').toUpperCase();
  const permission = options.authorize(
    requestContext,
    method === 'GET' ? options.PERMISSIONS.coreCustomerRead : options.PERMISSIONS.coreCustomerWrite,
  );
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };

  if (pathname === '/api/customer-groups' && method === 'GET') {
    await handleListGroups(req, res, context);
    return true;
  }
  if (pathname === '/api/customer-groups' && method === 'POST') {
    await handleCreateGroup(req, res, context);
    return true;
  }
  const groupMatch = pathname.match(/^\/api\/customer-groups\/([^/]+)$/);
  if (groupMatch && method === 'GET') {
    await handleGetGroup(res, context, groupMatch[1]);
    return true;
  }
  if (groupMatch && method === 'PATCH') {
    await handlePatchGroup(req, res, context, groupMatch[1]);
    return true;
  }

  if (pathname === '/api/customers' && method === 'GET') {
    await handleListCustomers(req, res, context);
    return true;
  }
  if (pathname === '/api/customers' && method === 'POST') {
    await handleCreateCustomer(req, res, context);
    return true;
  }

  const addressCollectionMatch = pathname.match(/^\/api\/customers\/([^/]+)\/addresses$/);
  if (addressCollectionMatch && method === 'GET') {
    await handleListAddresses(res, context, addressCollectionMatch[1]);
    return true;
  }
  if (addressCollectionMatch && method === 'POST') {
    await handleCreateAddress(req, res, context, addressCollectionMatch[1]);
    return true;
  }

  const addressMatch = pathname.match(/^\/api\/customers\/([^/]+)\/addresses\/([^/]+)$/);
  if (addressMatch && method === 'PATCH') {
    await handlePatchAddress(req, res, context, addressMatch[1], addressMatch[2]);
    return true;
  }

  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customerMatch && method === 'GET') {
    await handleGetCustomer(res, context, customerMatch[1]);
    return true;
  }
  if (customerMatch && method === 'PATCH') {
    await handlePatchCustomer(req, res, context, customerMatch[1]);
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
