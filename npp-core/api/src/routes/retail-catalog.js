import { createSuccessEnvelope } from '@npp/contracts';
import { normalizeIdempotencyKey } from '../idempotency.js';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import * as retailCatalogService from '../services/retail-catalog.js';
import * as retailProductLabelsService from '../services/retail-product-labels.js';
import * as retailPrintAgentService from '../services/retail-print-agent.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED' || code === 'PRINT_AGENT_UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (['SALES_ORDER_NOT_FOUND', 'VARIANT_NOT_FOUND', 'SALES_CHANNEL_NOT_FOUND', 'PRINT_AGENT_NOT_FOUND', 'PRINT_JOB_NOT_FOUND'].includes(code)) return 404;
  if (['BASE_PRICE_NOT_FOUND', 'VARIANT_NOT_PRICEABLE', 'PRINT_AGENT_OFFLINE', 'PRINT_JOB_NOT_CLAIMED'].includes(code)) return 409;
  return 400;
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Giá trị phải là số nguyên từ 0 đến ${max}`,
      statusCode: 400,
    });
  }
  return parsed;
}

function withWarehouseScopes(requestContext, warehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(warehouseIds),
    territoryIds: Object.freeze([...(requestContext.scopes?.territoryIds ?? [])]),
  });
  return Object.freeze({
    ...requestContext,
    scopes,
    authContext: requestContext.authContext ? Object.freeze({ ...requestContext.authContext, scopes }) : requestContext.authContext,
  });
}

async function ensureWarehouseScopes(options, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length > 0) return requestContext;
  if (!requestContext.roles?.includes('bootstrap')) return requestContext;
  const warehouses = await warehouseRepository.listWarehousesForInstallation(options.getPool(), {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
}

async function authorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Cần đăng nhập để tiếp tục', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Tài khoản chưa được cấp quyền thực hiện thao tác này', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return ensureWarehouseScopes(options, requestContext);
}

function sendServiceError(res, result, options) {
  sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)), options.requestId, options.receivedAt);
}

async function readLimitedJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += value.length;
    if (size > maxBytes) {
      throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), {
        code: 'PAYLOAD_TOO_LARGE', publicMessage: 'Nội dung yêu cầu vượt quá giới hạn cho phép', statusCode: 413,
      });
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('INVALID_JSON_BODY'), {
      code: 'INVALID_JSON_BODY', publicMessage: 'Nội dung yêu cầu không hợp lệ', statusCode: 400,
    });
  }
}

async function requestBody(req, res, options, maxBytes = 64 * 1024) {
  try {
    return await readLimitedJsonBody(req, maxBytes);
  } catch (error) {
    sendError(res, apiError(error.code ?? 'INVALID_INPUT', error.publicMessage ?? 'Nội dung yêu cầu không hợp lệ', {}, false, error.statusCode ?? 400), options.requestId, options.receivedAt);
    return null;
  }
}

function requireIdempotency(req, res, options) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) {
      sendError(res, apiError('MISSING_IDEMPOTENCY_KEY', 'Thiếu khóa chống gửi lệnh in trùng', {}, false, 400), options.requestId, options.receivedAt);
      return '';
    }
    return key;
  } catch {
    sendError(res, apiError('IDEMPOTENCY_KEY_INVALID', 'Khóa chống gửi trùng không hợp lệ', {}, false, 400), options.requestId, options.receivedAt);
    return '';
  }
}

async function authenticatePrintAgent(req, res, options) {
  try {
    const result = await retailPrintAgentService.authenticateAgent(options.getPool(), {
      installationId: options.config.installationId,
      deviceId: req.headers['x-retail-print-device-id'],
      credential: req.headers['x-retail-print-credential'],
    });
    if (!result.ok) {
      sendServiceError(res, result, options);
      return null;
    }
    return result.row;
  } catch {
    sendError(res, apiError('PRINT_AGENT_UNAVAILABLE', 'Retail Print tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
    return null;
  }
}

async function handlePrintAgentMachineRoutes(req, res, options, url) {
  if (url.pathname === '/api/retail/print-agent/agent/pairing' && req.method === 'POST') {
    const payload = await requestBody(req, res, options, 4096);
    if (payload === null) return true;
    const client = await options.getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await retailPrintAgentService.startPairing(client, {
        installationId: options.config.installationId,
        payload,
      });
      if (!result.ok) {
        await client.query('ROLLBACK');
        sendServiceError(res, result, options);
      } else {
        await client.query('COMMIT');
        sendSuccess(res, result.pairing, options.requestId, options.receivedAt);
      }
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      sendError(res, apiError('PRINT_AGENT_PAIRING_UNAVAILABLE', 'Chưa thể tạo mã kết nối Retail Print', {}, true, 503), options.requestId, options.receivedAt);
    } finally {
      client.release();
    }
    return true;
  }

  if (!url.pathname.startsWith('/api/retail/print-agent/agent/')) return false;
  const agent = await authenticatePrintAgent(req, res, options);
  if (!agent) return true;

  if (url.pathname === '/api/retail/print-agent/agent/heartbeat' && req.method === 'POST') {
    const payload = await requestBody(req, res, options, 4096);
    if (payload === null) return true;
    try {
      const result = await retailPrintAgentService.heartbeat(options.getPool(), {
        installationId: options.config.installationId,
        agentId: agent.id,
        printerName: payload.printerName,
        paperWidthMm: payload.paperWidthMm,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.agent, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRINT_AGENT_HEARTBEAT_UNAVAILABLE', 'Chưa thể cập nhật trạng thái Retail Print', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === '/api/retail/print-agent/agent/jobs' && req.method === 'GET') {
    const waitSeconds = retailPrintAgentService.retailPrintAgentInternals.normalizeWaitSeconds(url.searchParams.get('wait'));
    const deadline = Date.now() + waitSeconds * 1000;
    try {
      do {
        const result = await retailPrintAgentService.claimJob(options.getPool(), {
          installationId: options.config.installationId,
          agentId: agent.id,
        });
        if (!result.ok) return sendServiceError(res, result, options), true;
        if (result.job || Date.now() >= deadline) {
          sendSuccess(res, result.job, options.requestId, options.receivedAt);
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      } while (Date.now() < deadline);
      sendSuccess(res, null, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRINT_AGENT_QUEUE_UNAVAILABLE', 'Chưa thể nhận lệnh in', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const resultMatch = url.pathname.match(/^\/api\/retail\/print-agent\/agent\/jobs\/([^/]+)\/result$/);
  if (resultMatch && req.method === 'POST') {
    const payload = await requestBody(req, res, options, 4096);
    if (payload === null) return true;
    try {
      const result = await retailPrintAgentService.completeJob(options.getPool(), {
        installationId: options.config.installationId,
        agentId: agent.id,
        jobId: resultMatch[1],
        success: payload.success === true,
        errorCode: payload.errorCode,
        errorMessage: payload.errorMessage,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.job, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRINT_AGENT_RESULT_UNAVAILABLE', 'Chưa thể xác nhận kết quả in', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  sendError(res, apiError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', {}, false, 404), options.requestId, options.receivedAt);
  return true;
}

async function handlePrintAgentEmployeeRoutes(req, res, options, url) {
  if (!url.pathname.startsWith('/api/retail/print-agent/')) return false;

  if (url.pathname === '/api/retail/print-agent/status' && req.method === 'GET') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    try {
      const result = await retailPrintAgentService.listAgents(options.getPool(), { installationId: context.installationId });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.agents, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRINT_AGENT_STATUS_UNAVAILABLE', 'Chưa thể tải Retail Print đã kết nối', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === '/api/retail/print-agent/pair' && req.method === 'POST') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    const payload = await requestBody(req, res, options, 4096);
    if (payload === null) return true;
    try {
      const result = await retailPrintAgentService.pairAgent(options.getPool(), {
        installationId: context.installationId,
        actorId: context.actorId,
        pairingCode: payload.pairingCode,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.agent, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRINT_AGENT_PAIR_UNAVAILABLE', 'Chưa thể kết nối Retail Print', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const createMatch = url.pathname.match(/^\/api\/retail\/print-agent\/agents\/([^/]+)\/jobs$/);
  if (createMatch && req.method === 'POST') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    const key = requireIdempotency(req, res, options);
    if (!key) return true;
    const payload = await requestBody(req, res, options, 140 * 1024);
    if (payload === null) return true;
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext: context,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: url.pathname,
        payload: { agentId: createMatch[1], payload: payload.payload },
        onProcess: async () => {
          const result = await retailPrintAgentService.queueJob(options.getPool(), {
            installationId: context.installationId,
            actorId: context.actorId,
            agentId: createMatch[1],
            idempotencyKey: key,
            payload: payload.payload,
          });
          if (!result.ok) {
            return {
              statusCode: statusFor(result.code),
              contentType: 'application/json',
              requestId: options.requestId,
              body: { error: { code: result.code, message: result.message, retryable: Boolean(result.retryable), details: result.details ?? {} }, requestId: options.requestId, receivedAt: options.receivedAt },
            };
          }
          return {
            statusCode: 202,
            contentType: 'application/json',
            requestId: options.requestId,
            body: createSuccessEnvelope(result.job, options.requestId, options.receivedAt),
          };
        },
      });
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch {
      sendError(res, apiError('PRINT_JOB_QUEUE_UNAVAILABLE', 'Chưa thể gửi lệnh in', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const jobMatch = url.pathname.match(/^\/api\/retail\/print-agent\/jobs\/([^/]+)$/);
  if (jobMatch && req.method === 'GET') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    try {
      const result = await retailPrintAgentService.getJob(options.getPool(), {
        installationId: context.installationId,
        actorId: context.actorId,
        jobId: jobMatch[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.job, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('PRINT_JOB_STATUS_UNAVAILABLE', 'Chưa thể tải trạng thái lệnh in', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  sendError(res, apiError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', {}, false, 404), options.requestId, options.receivedAt);
  return true;
}

export async function handleRetailCatalogRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/retail/')) return false;

  if (await handlePrintAgentMachineRoutes(req, res, options, url)) return true;
  if (await handlePrintAgentEmployeeRoutes(req, res, options, url)) return true;

  if (url.pathname === '/api/retail/products' && req.method === 'GET') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreProductRead);
    if (!context) return true;
    try {
      const result = await retailCatalogService.searchRetailCatalog(options.getPool(), {
        requestContext: context,
        search: url.searchParams.get('search') ?? '',
        categoryId: url.searchParams.get('categoryId'),
        limit: parseInteger(url.searchParams.get('limit'), 30, 50),
        offset: parseInteger(url.searchParams.get('offset'), 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.products, options.requestId, options.receivedAt);
    } catch (error) {
      sendError(res, apiError(error.code ?? 'RETAIL_CATALOG_UNAVAILABLE', error.publicMessage ?? 'Chưa thể tải danh mục sản phẩm', {}, true, error.statusCode ?? 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === '/api/retail/product-labels' && req.method === 'POST') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreProductRead);
    if (!context) return true;
    const payload = await requestBody(req, res, options);
    if (payload === null) return true;
    try {
      const result = await retailProductLabelsService.getRetailProductLabels(options.getPool(), {
        requestContext: context,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.labels, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('RETAIL_PRODUCT_LABELS_UNAVAILABLE', 'Chưa thể tải tên sản phẩm', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === '/api/retail/price' && req.method === 'POST') {
    const context = await authorize(req, res, options, options.PERMISSIONS.corePriceRead);
    if (!context) return true;
    const payload = await requestBody(req, res, options);
    if (payload === null) return true;
    try {
      const result = await retailCatalogService.resolveRetailPrice(options.getPool(), {
        requestContext: context,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.resolution, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('RETAIL_PRICE_UNAVAILABLE', 'Chưa thể tính giá bán', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === '/api/retail/availability' && req.method === 'POST') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    const payload = await requestBody(req, res, options);
    if (payload === null) return true;
    try {
      const result = await retailCatalogService.previewRetailAvailability(options.getPool(), {
        requestContext: context,
        payload,
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.availability, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('RETAIL_AVAILABILITY_UNAVAILABLE', 'Chưa thể tính Khả dụng', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  const availability = url.pathname.match(/^\/api\/retail\/sales-orders\/([^/]+)\/availability$/);
  if (availability && req.method === 'GET') {
    const context = await authorize(req, res, options, options.PERMISSIONS.coreSalesOrderRead);
    if (!context) return true;
    try {
      const result = await retailCatalogService.getRetailOrderAvailability(options.getPool(), {
        requestContext: context,
        salesOrderId: availability[1],
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.availability, options.requestId, options.receivedAt);
    } catch {
      sendError(res, apiError('RETAIL_AVAILABILITY_UNAVAILABLE', 'Chưa thể tải Khả dụng của đơn', {}, true, 503), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (!['GET', 'POST'].includes(req.method ?? '')) {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Phương thức yêu cầu không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }
  sendError(res, apiError('NOT_FOUND', 'Không tìm thấy chức năng yêu cầu', {}, false, 404), options.requestId, options.receivedAt);
  return true;
}
