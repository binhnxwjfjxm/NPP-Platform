import * as repository from '../db/repositories/customer-profile.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD_DAYS = Object.freeze({ '30d': 30, '90d': 90, '365d': 365, all: null });

function validWarehouseIds(requestContext) {
  return Array.isArray(requestContext?.scopes?.warehouseIds)
    ? [...new Set(requestContext.scopes.warehouseIds.filter((value) => UUID_PATTERN.test(String(value))).map((value) => String(value).trim()))]
    : [];
}

function salesVisibility(requestContext) {
  const permissions = Array.isArray(requestContext?.permissions) ? requestContext.permissions : [];
  const employeeId = UUID_PATTERN.test(String(requestContext?.employeeId ?? ''))
    ? String(requestContext.employeeId).trim()
    : null;
  const actorId = typeof requestContext?.actorId === 'string' && requestContext.actorId.trim()
    ? requestContext.actorId.trim()
    : null;
  return Object.freeze({
    employeeId,
    actorId,
    allowAllEmployees: permissions.includes('core.sales-order.read-all'),
  });
}

export function normalizeCustomerProfilePeriod(value) {
  const period = String(value ?? '90d').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PERIOD_DAYS, period) ? period : null;
}

function sinceInstant(period, receivedAt) {
  const days = PERIOD_DAYS[period];
  if (days === null) return null;
  const base = new Date(receivedAt);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() - days);
  return base.toISOString();
}

export async function loadCustomerSalesSummary(client, { requestContext, customerId, period }) {
  if (!UUID_PATTERN.test(String(customerId ?? '').trim())) {
    return { ok: false, code: 'INVALID_CUSTOMER_ID', message: 'Mã khách hàng không hợp lệ.' };
  }
  const normalizedPeriod = normalizeCustomerProfilePeriod(period);
  if (!normalizedPeriod) {
    return { ok: false, code: 'INVALID_CUSTOMER_PROFILE_PERIOD', message: 'Khoảng thời gian không hợp lệ.' };
  }
  const row = await repository.getCustomerSalesSummary(client, {
    installationId: requestContext.installationId,
    customerId: String(customerId).trim(),
    warehouseIds: validWarehouseIds(requestContext),
    ...salesVisibility(requestContext),
    sinceInstant: sinceInstant(normalizedPeriod, requestContext.receivedAt),
  });
  return {
    ok: true,
    summary: Object.freeze({
      period: normalizedPeriod,
      currencyCode: 'VND',
      revenue: String(row.revenue ?? '0'),
      orderCount: String(row.order_count ?? '0'),
      lastPurchaseAt: row.last_purchase_at ? new Date(row.last_purchase_at).toISOString() : null,
    }),
  };
}

export async function loadCustomerReceivableSummary(client, { requestContext, customerId }) {
  if (!UUID_PATTERN.test(String(customerId ?? '').trim())) {
    return { ok: false, code: 'INVALID_CUSTOMER_ID', message: 'Mã khách hàng không hợp lệ.' };
  }
  const row = await repository.getCustomerReceivableSummary(client, {
    installationId: requestContext.installationId,
    customerId: String(customerId).trim(),
    warehouseIds: validWarehouseIds(requestContext),
  });
  return {
    ok: true,
    summary: Object.freeze({
      currencyCode: 'VND',
      balance: String(row.balance ?? '0'),
      openAmount: String(row.open_amount ?? '0'),
      openDocumentCount: String(row.open_document_count ?? '0'),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }),
  };
}
