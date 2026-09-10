import { sendError, sendSuccess } from '../http-utils.js';
import * as customerService from '../services/customer.js';
import * as profileService from '../services/customer-profile.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code, message, statusCode) {
  return { code, message, details: {}, retryable: false, statusCode };
}

async function warehouseScopedContext(client, requestContext) {
  const current = Array.isArray(requestContext.scopes?.warehouseIds)
    ? requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(String(value)))
    : [];
  if (current.length > 0 || !Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(warehouses.map((warehouse) => warehouse.id)),
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

export async function handleCustomerProfileRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const match = url.pathname.match(/^\/api\/customers\/([^/]+)\/overview$/);
  if (!match) return false;
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    sendError(res, error('METHOD_NOT_ALLOWED', 'Method not allowed', 405), options.requestId, options.receivedAt);
    return true;
  }

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, error('UNAUTHORIZED', 'Authorization required', 401), options.requestId, options.receivedAt);
    return true;
  }
  let requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, options.PERMISSIONS.coreCustomerRead).ok) {
    sendError(res, error('FORBIDDEN', 'Permission denied', 403), options.requestId, options.receivedAt);
    return true;
  }

  const customerId = match[1];
  if (!UUID_PATTERN.test(customerId)) {
    sendError(res, error('INVALID_CUSTOMER_ID', 'Mã khách hàng không hợp lệ.', 400), options.requestId, options.receivedAt);
    return true;
  }
  const period = profileService.normalizeCustomerProfilePeriod(url.searchParams.get('period'));
  if (!period) {
    sendError(res, error('INVALID_CUSTOMER_PROFILE_PERIOD', 'Khoảng thời gian không hợp lệ.', 400), options.requestId, options.receivedAt);
    return true;
  }

  try {
    const pool = options.getPool();
    const customerResult = await customerService.getCustomer(pool, {
      installationId: requestContext.installationId,
      id: customerId,
    });
    if (!customerResult.ok) {
      sendError(res, error('CUSTOMER_NOT_FOUND', 'Không tìm thấy khách hàng.', 404), options.requestId, options.receivedAt);
      return true;
    }

    requestContext = await warehouseScopedContext(pool, requestContext);
    const canReadSales = options.authorize(requestContext, options.PERMISSIONS.coreSalesOrderRead).ok;
    const canReadReceivable = options.authorize(requestContext, options.PERMISSIONS.coreReceivableRead).ok;
    const [salesResult, receivableResult] = await Promise.all([
      canReadSales
        ? profileService.loadCustomerSalesSummary(pool, { requestContext, customerId, period })
        : Promise.resolve(null),
      canReadReceivable
        ? profileService.loadCustomerReceivableSummary(pool, { requestContext, customerId })
        : Promise.resolve(null),
    ]);
    if (salesResult && !salesResult.ok) {
      sendError(res, error(salesResult.code, salesResult.message, 400), options.requestId, options.receivedAt);
      return true;
    }
    if (receivableResult && !receivableResult.ok) {
      sendError(res, error(receivableResult.code, receivableResult.message, 400), options.requestId, options.receivedAt);
      return true;
    }

    sendSuccess(res, Object.freeze({
      customer: customerResult.customer,
      period,
      sales: salesResult?.summary ?? null,
      receivable: receivableResult?.summary ?? null,
      permissions: Object.freeze({ sales: canReadSales, receivable: canReadReceivable }),
    }), options.requestId, options.receivedAt);
  } catch {
    sendError(
      res,
      { code: 'CUSTOMER_PROFILE_UNAVAILABLE', message: 'Chưa tải được tổng quan khách hàng.', details: {}, retryable: true, statusCode: 503 },
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}
